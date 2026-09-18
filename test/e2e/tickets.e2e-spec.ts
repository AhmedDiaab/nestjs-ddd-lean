import { createHmac } from 'node:crypto';
import { TicketQueryPortToken } from '@application/ports';
import { TicketRepositoryToken } from '@domain';
import { VersioningType, type INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Test } from '@nestjs/testing';
import { AppModule } from '@src/app.module';
import request from 'supertest';
import type { App } from 'supertest/types';
import { InMemoryTickets } from '../fakes/in-memory-tickets';

const SECRET = 'e2e-secret-that-is-at-least-32-chars';

/**
 * The app only verifies tokens (passport-jwt); nothing in `src` signs one, so this test signs
 * its own HS256 token by hand rather than pulling in a JWT library just for the test.
 */
const base64url = (input: string): string => Buffer.from(input).toString('base64url');

const signHs256 = (payload: Record<string, unknown>, secret: string): string => {
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = base64url(JSON.stringify(payload));
    const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
    return `${header}.${body}.${signature}`;
};

describe('Tickets API (e2e, in-memory persistence)', () => {
    let app: INestApplication<App>;
    let token: string;
    const tickets = new InMemoryTickets();

    beforeAll(async () => {
        Object.assign(process.env, {
            NODE_ENV: 'test',
            JWT_SECRET: SECRET,
            LOGGING_TO_FILE: 'false',
            LOG_LEVEL: 'error',
        });
        delete process.env.DATABASE_CONFIG_JSON;

        const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
            .overrideProvider(TicketRepositoryToken)
            .useValue(tickets.repository)
            .overrideProvider(TicketQueryPortToken)
            .useValue(tickets.queries)
            .compile();

        app = moduleRef.createNestApplication();
        app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
        await app.init();

        token = signHs256({ username: 'alice', id: '1' }, SECRET);
    });

    afterAll(() => app.close());

    const api = () => request(app.getHttpServer());
    const auth = { Authorization: '' };
    beforeEach(() => {
        auth.Authorization = `Bearer ${token}`;
        tickets.store.clear();
    });

    const openTicket = async (title = 'Printer') => {
        const res = await api().post('/v1/tickets').set(auth).send({ title }).expect(201);
        return (res.body as { data: { id: string } }).data.id;
    };

    it('requires authentication', async () => {
        // Arrange: no Authorization header

        // Act
        const res = await api().get('/v1/tickets');

        // Assert
        expect(res.status).toBe(401);
    });

    it('opens a ticket', async () => {
        // Arrange
        const body = { title: 'Printer' };

        // Act
        const res = await api().post('/v1/tickets').set(auth).send(body);

        // Assert
        expect(res.status).toBe(201);
        const { success, data } = res.body as { success: boolean; data: { id: string } };
        expect(success).toBe(true);
        expect(tickets.store.has(data.id)).toBe(true);
    });

    it('reads a ticket', async () => {
        // Arrange
        const id = await openTicket();

        // Act
        const res = await api().get(`/v1/tickets/${id}`).set(auth);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            success: true,
            data: { id, status: 'open', createdBy: 'alice' },
        });
    });

    it('lists tickets by status', async () => {
        // Arrange
        const id = await openTicket();

        // Act
        const res = await api().get('/v1/tickets?status=open&size=10').set(auth);

        // Assert
        expect(res.status).toBe(200);
        const listed = (res.body as { data: { data: { id: string }[] } }).data.data;
        expect(listed.map((t) => t.id)).toEqual([id]);
    });

    it('closes a ticket', async () => {
        // Arrange
        const id = await openTicket();

        // Act
        const res = await api().post(`/v1/tickets/${id}/close`).set(auth);

        // Assert
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ success: true, data: { id, status: 'closed' } });
    });

    it('returns 409 when closing a closed ticket', async () => {
        // Arrange
        const id = await openTicket();
        await api().post(`/v1/tickets/${id}/close`).set(auth).expect(200);

        // Act
        const res = await api().post(`/v1/tickets/${id}/close`).set(auth);

        // Assert
        expect(res.status).toBe(409);
        expect(res.body).toMatchObject({ success: false });
    });

    it.each([
        ['a blank title (domain validation)', 'post', '/v1/tickets', { title: '   ' }, 422],
        ['a missing title (schema validation)', 'post', '/v1/tickets', {}, 400],
        ['a malformed id', 'get', '/v1/tickets/not-a-uuid', undefined, 400],
        [
            'an unknown ticket',
            'get',
            '/v1/tickets/3f2c3c0e-8c1c-4a55-9a6f-2a0b8f7d9c11',
            undefined,
            404,
        ],
    ] as const)('returns the right status for %s', async (_case, method, path, body, status) => {
        // Arrange
        const call = method === 'post' ? api().post(path).send(body) : api().get(path);

        // Act
        const res = await call.set(auth);

        // Assert
        expect(res.status).toBe(status);
    });

    it('documents the tickets API in Swagger from the Zod schemas', () => {
        // Arrange
        const builder = new DocumentBuilder().build();

        // Act
        const document = SwaggerModule.createDocument(app, builder);

        // Assert
        const list = document.paths['/v1/tickets'].get;
        const names = ((list?.parameters ?? []) as { name: string }[]).map((p) => p.name);
        expect(names).toEqual(expect.arrayContaining(['page', 'size', 'orderBy', 'status']));
        expect(document.paths['/v1/tickets/{id}'].get?.responses['200']).toBeDefined();
        expect(document.paths['/v1/tickets'].post?.requestBody).toBeDefined();
    });
});
