import { randomUUID } from 'node:crypto';
import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LoggerPort } from '@application/ports';
import { isSafeCorrelationId } from '@shared';
import type { NextFunction, Request, Response } from 'express';
import { buildForwardHeaders, stripHopByHopHeaders } from './forward-headers.util';
import { matchesLegacyPrefix } from './matches-prefix.util';

/**
 * How a forwarded request ended: the legacy service answered (`completed`, whatever its status),
 * the client hung up first (`aborted`), or this hop itself failed (`failed`, 502/504).
 */
type ForwardOutcome = 'completed' | 'aborted' | 'failed';

type ForwardLogContext = {
    req: Request;
    requestId: string;
    startedAt: number;
    /** Absent when the request ended before the legacy service sent a status. */
    status?: number;
};

export type LegacyForwarderOptions = {
    /** Base URL of the legacy service, e.g. `http://legacy-host:8080`. */
    targetUrl: string;
    /** Path prefixes forwarded as-is; everything else falls through to `next()`. */
    forwardPrefixes: readonly string[];
    /** Per-request timeout to the legacy service. */
    timeoutMs: number;
    /** Forward the client's original Host header instead of the legacy target's. */
    preserveHostHeader: boolean;
    /** Header name carrying the correlation id, e.g. `x-request-id` (`logging.requestIdHeader`). */
    requestIdHeader: string;
    /** Log one line per forwarded request; failures are logged regardless. */
    logRequests: boolean;
    /**
     * Where the forwarding log goes. `src/main.ts` passes a `PinoFileLogger` writing to
     * `LEGACY_LOG_FILE_NAME`, so legacy traffic keeps its own file instead of being interleaved
     * with this service's own requests in `app.log`.
     */
    logger: LoggerPort;
};

/**
 * Dumb transport for paths not yet migrated off a legacy service (option B, "New service in
 * front" — `docs/guides/migrate-a-legacy-service.md`). No `@nestjs/*`, no `HttpClient`: only
 * `node:http`/`node:https`, so the request and response bodies stream through unchanged instead
 * of being buffered and re-serialized. Mounted with `app.use()` in `src/main.ts`, before the
 * body parsers, so the raw request stream is still intact when it arrives here — see decision
 * 0013.
 *
 * Runs before `RequestIdMiddleware` (a Nest middleware, wired later in the pipeline), so it
 * resolves its own request id instead of reading one from the request context.
 *
 * It is also the only place a forwarded request is ever logged: answering here means Nest's
 * router — and with it pino-http's access log — never sees the request, so every forwarded call
 * would otherwise leave no trace at all. Each one gets a `legacy.forward.completed` line (or
 * `legacy.forward.failed`/`legacy.forward.aborted`), with the method, path, status and latency
 * only — never a body, a header or a query string, which can carry tokens, cookies or PII
 * (decision 0013).
 */
export class LegacyForwarder {
    private readonly target: URL;
    private readonly client: typeof http | typeof https;
    private readonly targetHost: string;

    constructor(private readonly options: LegacyForwarderOptions) {
        this.target = new URL(options.targetUrl);
        this.client = this.target.protocol === 'https:' ? https : http;
        this.targetHost = this.target.port
            ? `${this.target.hostname}:${this.target.port}`
            : this.target.hostname;
    }

    /** Express-compatible middleware: forwards a matched path, calls `next()` otherwise. */
    middleware() {
        return (req: Request, res: Response, next: NextFunction): void => {
            if (!matchesLegacyPrefix(req.path, this.options.forwardPrefixes)) {
                next();
                return;
            }
            this.forward(req, res);
        };
    }

    private forward(req: Request, res: Response): void {
        const requestId = this.requestIdFor(req);
        const startedAt = Date.now();
        const headers = buildForwardHeaders({
            headers: req.headers,
            remoteAddress: req.socket.remoteAddress ?? 'unknown',
            protocol: req.protocol === 'https' ? 'https' : 'http',
            hostHeader: req.headers.host,
            targetHost: this.targetHost,
            preserveHostHeader: this.options.preserveHostHeader,
            requestId: { header: this.options.requestIdHeader, value: requestId },
        });

        const outbound = this.client.request({
            protocol: this.target.protocol,
            hostname: this.target.hostname,
            port: this.target.port || (this.target.protocol === 'https:' ? 443 : 80),
            method: req.method,
            path: req.originalUrl,
            headers,
            timeout: this.options.timeoutMs,
        });

        let timedOut = false;
        // Exactly one outcome per forwarded request: a failure after the response started would
        // otherwise also arrive as a `close` on the response and be logged a second time, as a
        // completed forward carrying the status the legacy service had already sent.
        let settled = false;
        const settle = (outcome: ForwardOutcome, status?: number): void => {
            if (settled) return;
            settled = true;
            this.logOutcome(outcome, { req, requestId, startedAt, status });
        };

        outbound.on('timeout', () => {
            timedOut = true;
            // An explicit error guarantees the 'error' event fires so the response below is
            // always sent; destroy() with no argument does not reliably emit one.
            outbound.destroy(new Error('legacy service timed out'));
        });

        outbound.on('response', (upstream: IncomingMessage) => {
            // The status and body pass through untouched; the hop-by-hop headers do not, since
            // they describe this app's connection to the legacy service, not the client's.
            const status = upstream.statusCode ?? 502;
            res.writeHead(status, stripHopByHopHeaders(upstream.headers));
            // Logged on 'close' rather than here: the status is known now, but the latency is
            // only meaningful once the body has actually finished streaming to the client — and
            // `close` is the one event that covers both endings, `writableFinished` telling them
            // apart. A client that hangs up mid-response emits nothing else: `aborted` on the
            // REQUEST only fires while the request message itself is incomplete (and is
            // deprecated since Node 17), so it never sees the ordinary GET-abort case.
            res.on('close', () => {
                if (res.writableFinished) {
                    settle('completed', status);
                    return;
                }
                settle('aborted', status);
                // The client is gone; the upstream socket must not stay open for a body nobody
                // will read.
                outbound.destroy();
            });
            upstream.pipe(res);
        });

        outbound.on('error', () => {
            const status = timedOut ? 504 : 502;
            // A client that hung up first has already settled as `aborted`: that is not a
            // legacy-service failure, and `legacy.forward.failed` stays a signal about this hop.
            settle('failed', status);
            if (!res.headersSent) {
                res.writeHead(status, { 'content-type': 'text/plain' });
                res.end(status === 504 ? 'Gateway Timeout' : 'Bad Gateway');
            } else {
                res.destroy();
            }
        });

        // A client that disconnects while still sending its request must not leave the outbound
        // socket open. This is the upload-phase abort; the response-phase one is handled above.
        req.on('aborted', () => {
            settle('aborted');
            outbound.destroy();
        });

        req.pipe(outbound);
    }

    /**
     * One line per forwarded request: the method, path, correlation id, latency and — when it is
     * known — the status, never a body, header or query string (they can carry tokens, cookies or
     * PII). `LEGACY_LOG_REQUESTS=false` keeps only `legacy.forward.failed`, this hop's own signal.
     */
    private logOutcome(outcome: ForwardOutcome, context: ForwardLogContext): void {
        if (outcome !== 'failed' && !this.options.logRequests) return;

        const meta = {
            method: context.req.method,
            path: context.req.path,
            requestId: context.requestId,
            latencyMs: Date.now() - context.startedAt,
            ...(context.status === undefined ? {} : { status: context.status }),
        };

        if (outcome === 'failed') this.options.logger.error('legacy.forward.failed', meta);
        else if (outcome === 'aborted') this.options.logger.warn('legacy.forward.aborted', meta);
        else this.options.logger.info('legacy.forward.completed', meta);
    }

    /** A caller may supply the correlation id, but not arbitrary bytes; see `isSafeCorrelationId`. */
    private requestIdFor(req: Request): string {
        const header = req.headers[this.options.requestIdHeader.toLowerCase()];
        const candidate = Array.isArray(header) ? header[0] : header;
        return isSafeCorrelationId(candidate) ? candidate : randomUUID();
    }
}
