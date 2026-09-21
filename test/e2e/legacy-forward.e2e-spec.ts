import {
    createServer,
    request as httpRequest,
    type IncomingMessage,
    type Server,
    type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LoggerPort } from '@application/ports';
import { LegacyForwarder } from '@infrastructure/legacy';
import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import cookieParser from 'cookie-parser';
import type { Request, Response } from 'express';
import helmet from 'helmet';
import request from 'supertest';

type Envelope = { success: boolean; meta?: { path?: string } };

describe('Legacy forwarding (e2e)', () => {
    let app: NestExpressApplication;
    let upstream: Server;
    let upstreamPort: number;
    let capturedHeaders: IncomingMessage['headers'] = {};
    type LogLine = { level: 'info' | 'warn' | 'error'; message: string; meta: unknown };
    const logged: LogLine[] = [];
    const loggedErrors = (): LogLine[] => logged.filter((line) => line.level === 'error');
    const linesFor = (message: string): LogLine[] =>
        logged.filter((line) => line.message === message);
    // The forwarder writes to a PinoFileLogger (its own rotated file) in src/main.ts; here a fake
    // stands in for it, so the assertions are about what is logged, not where it lands.
    const forwarderLogger: LoggerPort = {
        debug: () => undefined,
        info: (message, meta) => logged.push({ level: 'info', message, meta }),
        warn: (message, meta) => logged.push({ level: 'warn', message, meta }),
        error: (message, meta) => logged.push({ level: 'error', message, meta }),
    };

    // express is not a direct dependency of this template, so a forwarder that needs a server of
    // its own is mounted on node:http, with the two fields express would have added set by hand.
    const bareServers: Server[] = [];
    const mountForwarder = async (logRequests: boolean, timeoutMs: number): Promise<Server> => {
        const forwarder = new LegacyForwarder({
            targetUrl: `http://127.0.0.1:${upstreamPort}`,
            forwardPrefixes: ['/v1/legacy'],
            timeoutMs,
            preserveHostHeader: false,
            requestIdHeader: 'x-request-id',
            logRequests,
            logger: forwarderLogger,
        });
        const server = createServer((req: IncomingMessage, res: ServerResponse) => {
            const path = (req.url ?? '/').split('?')[0];
            Object.assign(req, { path, protocol: 'http', originalUrl: req.url });
            forwarder.middleware()(req as unknown as Request, res as unknown as Response, () => {
                res.writeHead(404);
                res.end();
            });
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        bareServers.push(server);
        return server;
    };

    const waitForLine = async (message: string): Promise<void> => {
        for (let attempt = 0; attempt < 200; attempt++) {
            if (linesFor(message).length > 0) return;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
        throw new Error(`timed out waiting for ${message}`);
    };

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: 'e2e-secret-that-is-at-least-32-chars',
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        // A real upstream: proves bytes stream through the forwarder rather than being parsed.
        upstream = createServer((req: IncomingMessage, res: ServerResponse) => {
            const path = (req.url ?? '').split('?')[0];

            if (path === '/v1/legacy/echo') {
                capturedHeaders = req.headers;
                req.resume();
                res.writeHead(201, {
                    'x-upstream': 'legacy-value',
                    'content-type': 'text/plain',
                    // hop-by-hop: describes the forwarder's connection, not the client's
                    connection: 'keep-alive',
                    'keep-alive': 'timeout=5',
                });
                res.end('hello from legacy');
                return;
            }

            if (path === '/v1/legacy/boom') {
                req.resume();
                res.writeHead(500, { 'content-type': 'text/plain' });
                res.end('legacy failure');
                return;
            }

            if (path === '/v1/legacy/half-body') {
                req.resume();
                // Headers and part of the body, then nothing: the response starts and never ends,
                // so this hop fails (or the client hangs up) AFTER the status has been sent on.
                res.writeHead(200, { 'content-type': 'text/plain' });
                res.write('first chunk');
                return;
            }

            if (path === '/v1/legacy/stall') {
                req.resume();
                // Deliberately never responds, to exercise the forwarder's own timeout.
                return;
            }

            if (path === '/v1/legacy/big') {
                let receivedLength = 0;
                req.on('data', (chunk: Buffer) => (receivedLength += chunk.length));
                req.on('end', () => {
                    res.writeHead(200, { 'content-type': 'application/json' });
                    res.end(JSON.stringify({ receivedLength }));
                });
                return;
            }

            req.resume();
            res.writeHead(404);
            res.end();
        });
        await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
        upstreamPort = (upstream.address() as AddressInfo).port;

        // Same pipeline order as src/main.ts: helmet, then the legacy forwarder, then
        // cookieParser and the body parsers — the forwarder must see the raw, unparsed stream.
        const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
        app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });

        app.use(helmet());

        const forwarder = new LegacyForwarder({
            targetUrl: `http://127.0.0.1:${upstreamPort}`,
            forwardPrefixes: ['/v1/legacy'],
            timeoutMs: 1000,
            preserveHostHeader: false,
            requestIdHeader: 'x-request-id',
            logRequests: true,
            logger: forwarderLogger,
        });
        app.use(forwarder.middleware());

        app.use(cookieParser());
        app.useBodyParser('json', { limit: '1mb' });
        app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });

        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();
    });

    afterAll(async () => {
        await app.close();
        for (const server of bareServers) {
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        await new Promise<void>((resolve) => upstream.close(() => resolve()));
    });

    it('reaches the upstream for a configured prefix, with status, headers and body intact', async () => {
        // Arrange: '/v1/legacy' is a configured forward prefix

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/echo');

        // Assert
        expect(res.status).toBe(201);
        expect(res.headers['x-upstream']).toBe('legacy-value');
        expect(res.text).toBe('hello from legacy');
    });

    it('does not repeat the upstream hop-by-hop headers to the client', async () => {
        // Arrange: the upstream answers /echo with connection and keep-alive headers

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/echo');

        // Assert
        expect(res.headers['keep-alive']).toBeUndefined();
    });

    it('lets the upstream see Authorization, cookies and the request-id header', async () => {
        // Arrange
        capturedHeaders = {};

        // Act
        await request(app.getHttpServer())
            .get('/v1/legacy/echo')
            .set('Authorization', 'Bearer legacy-token')
            .set('Cookie', 'session=abc123')
            .set('x-request-id', 'trace-legacy-1');

        // Assert
        expect(capturedHeaders.authorization).toBe('Bearer legacy-token');
        expect(capturedHeaders.cookie).toBe('session=abc123');
        expect(capturedHeaders['x-request-id']).toBe('trace-legacy-1');
    });

    it('still returns the 404 envelope from FallbackController for an unmatched path', async () => {
        // Arrange
        const path = '/v1/not-yet-migrated';

        // Act
        const res = await request(app.getHttpServer()).get(path);

        // Assert
        expect(res.status).toBe(404);
        expect(res.body as Envelope).toMatchObject({ success: false, meta: { path } });
    });

    it('passes an upstream 500 through as 500, not 503', async () => {
        // Arrange: '/v1/legacy/boom' always answers 500

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/boom');

        // Assert
        expect(res.status).toBe(500);
        expect(res.text).toBe('legacy failure');
    });

    it('returns 504 within the configured timeout when the upstream never responds', async () => {
        // Arrange
        logged.length = 0;
        const startedAt = Date.now();

        // Act
        const res = await request(app.getHttpServer()).get('/v1/legacy/stall');
        const elapsedMs = Date.now() - startedAt;

        // Assert: well within the suite's own timeout, and never full-hangs
        expect(res.status).toBe(504);
        expect(elapsedMs).toBeLessThan(3000);
        expect(loggedErrors()).toHaveLength(1);
        expect(loggedErrors()[0]?.message).toBe('legacy.forward.failed');
        expect(loggedErrors()[0]?.meta).toMatchObject({ status: 504 });
    });

    it('logs one line per forwarded request, with the status, latency and correlation id', async () => {
        // Arrange
        logged.length = 0;

        // Act
        await request(app.getHttpServer())
            .get('/v1/legacy/echo')
            .set('x-request-id', 'trace-legacy-log');

        // Assert
        const completed = linesFor('legacy.forward.completed');
        expect(completed).toHaveLength(1);
        expect(completed[0]?.level).toBe('info');
        expect(completed[0]?.meta).toMatchObject({
            method: 'GET',
            path: '/v1/legacy/echo',
            status: 201,
            requestId: 'trace-legacy-log',
        });
        expect((completed[0]?.meta as { latencyMs: number }).latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('logs the legacy status as it was, without turning a 500 into a failure of this hop', async () => {
        // Arrange
        logged.length = 0;

        // Act
        await request(app.getHttpServer()).get('/v1/legacy/boom');

        // Assert
        expect(linesFor('legacy.forward.completed')[0]?.meta).toMatchObject({ status: 500 });
        expect(loggedErrors()).toHaveLength(0);
    });

    it('never logs the query string, a header or a body', async () => {
        // Arrange
        logged.length = 0;

        // Act
        await request(app.getHttpServer())
            .get('/v1/legacy/echo?token=super-secret')
            .set('Authorization', 'Bearer legacy-token');

        // Assert
        const serialized = JSON.stringify(logged);
        expect(serialized).not.toContain('super-secret');
        expect(serialized).not.toContain('legacy-token');
    });

    it('logs a failure that happens after the response started once, not also as completed', async () => {
        // Arrange: the upstream sends headers and a chunk, then stalls past the 1s timeout
        logged.length = 0;

        // Act
        await request(app.getHttpServer())
            .get('/v1/legacy/half-body')
            .catch(() => undefined); // the truncated response rejects in the client

        // Assert: the status the legacy service had already sent must not read as a success
        await waitForLine('legacy.forward.failed');
        // the response is destroyed after the failure is logged; its 'close' lands a tick later
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(linesFor('legacy.forward.failed')).toHaveLength(1);
        expect(linesFor('legacy.forward.failed')[0]?.meta).toMatchObject({ status: 504 });
        expect(linesFor('legacy.forward.completed')).toHaveLength(0);
    });

    it('logs a client that hangs up mid-response as aborted, not as completed', async () => {
        // Arrange: a long timeout, so only the client ends this request
        const server = await mountForwarder(true, 5000);
        const { port } = server.address() as AddressInfo;
        logged.length = 0;

        // Act
        await new Promise<void>((resolve) => {
            const clientRequest = httpRequest(
                { host: '127.0.0.1', port, path: '/v1/legacy/half-body' },
                (res) => {
                    res.on('data', () => clientRequest.destroy());
                    res.on('close', () => resolve());
                },
            );
            clientRequest.on('error', () => resolve());
            clientRequest.end();
        });

        // Assert
        await waitForLine('legacy.forward.aborted');
        expect(linesFor('legacy.forward.aborted')[0]?.level).toBe('warn');
        expect(linesFor('legacy.forward.aborted')[0]?.meta).toMatchObject({
            method: 'GET',
            path: '/v1/legacy/half-body',
            status: 200,
        });
        expect(linesFor('legacy.forward.completed')).toHaveLength(0);
    });

    it('logs nothing per request when LEGACY_LOG_REQUESTS is off', async () => {
        // Arrange
        const server = await mountForwarder(false, 200);
        logged.length = 0;

        // Act
        await request(server).get('/v1/legacy/echo');

        // Assert
        expect(logged).toHaveLength(0);
    });

    it('still logs failures when LEGACY_LOG_REQUESTS is off', async () => {
        // Arrange
        const server = await mountForwarder(false, 200);
        logged.length = 0;

        // Act
        await request(server).get('/v1/legacy/stall');

        // Assert
        expect(linesFor('legacy.forward.failed')).toHaveLength(1);
    });

    it('round-trips a multi-megabyte body without buffering it', async () => {
        // Arrange: 5 MiB, big enough to prove nothing buffers, small enough to stay fast
        const payload = Buffer.alloc(5 * 1024 * 1024, 'x');

        // Act
        const res = await request(app.getHttpServer())
            .post('/v1/legacy/big')
            .set('content-type', 'application/octet-stream')
            .send(payload);

        // Assert
        expect(res.status).toBe(200);
        expect((res.body as { receivedLength: number }).receivedLength).toBe(payload.length);
    });
});
