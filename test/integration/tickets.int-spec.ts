/**
 * Live Oracle checks for the Tickets SQL (MERGE upsert, lookup, filtered paging).
 * Skipped unless ORACLE_IT_PASSWORD is set, same env as oracle.client.int-spec.ts.
 * Creates the `tickets` table from docs/guides/feature-walkthrough.md and drops it afterwards,
 * so it refuses to run against a schema that already has one.
 */
import type { LoggerPort } from '@application/ports';
import { Ticket, TicketTitle } from '@domain';
import { databaseConfigSchema } from '@infrastructure/config/schemas';
import { PoolManager } from '@infrastructure/database/connection';
import { TicketQueryDao } from '@infrastructure/database/queries';
import { OracleTicketRepository } from '@infrastructure/database/repositories';
import type { Connection } from 'oracledb';

const password = process.env.ORACLE_IT_PASSWORD;
const describeLive = password ? describe : describe.skip;

const DDL = `
    CREATE TABLE tickets (
        id          VARCHAR2(36)  PRIMARY KEY,
        title       VARCHAR2(200) NOT NULL,
        status      VARCHAR2(10)  NOT NULL CHECK (status IN ('open', 'closed')),
        created_by  VARCHAR2(64)  NOT NULL,
        created_at  TIMESTAMP     NOT NULL,
        closed_at   TIMESTAMP
    )`;

const titled = (raw: string) => {
    const title = TicketTitle.create(raw);
    if (!title.ok) throw title.error;
    return title.value;
};

describeLive('Tickets SQL (live Oracle)', () => {
    const logger: LoggerPort = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const db = new PoolManager(logger);
    const repository = new OracleTicketRepository(db);
    const queries = new TicketQueryDao(db);
    let created = false;

    beforeAll(async () => {
        await db.init(
            databaseConfigSchema.parse({
                sources: [
                    {
                        key: 'main',
                        dialect: 'oracle',
                        connectString:
                            process.env.ORACLE_IT_CONNECT_STRING ?? 'localhost:1521/FREEPDB1',
                        user: process.env.ORACLE_IT_USER ?? 'app',
                        password,
                    },
                ],
                health: {},
            }),
        );
        await db.withConnection('main', (conn: Connection) => conn.execute(DDL));
        created = true;
    });

    afterAll(async () => {
        if (created) {
            await db.withConnection('main', (conn: Connection) =>
                conn.execute('DROP TABLE tickets PURGE'),
            );
        }
        await db.onModuleDestroy();
    });

    beforeEach(async () => {
        await db.transaction('main', (conn: Connection) => conn.execute('DELETE FROM tickets'));
    });

    const openTicket = async (id: string, title: string, minute: number) => {
        const ticket = Ticket.open({
            id,
            title: titled(title),
            createdBy: 'alice',
            now: new Date(Date.UTC(2026, 0, 1, 10, minute)),
        });
        await repository.save(ticket, { actor: 'alice' });
        return ticket;
    };

    it('inserts a new ticket through MERGE and reads it back as the aggregate', async () => {
        // Arrange
        const ticket = await openTicket('00000000-0000-4000-8000-000000000001', 'Printer', 0);

        // Act
        const loaded = await repository.findById(ticket.id, { actor: 'alice' });

        // Assert
        expect(loaded).toBeInstanceOf(Ticket);
        expect(loaded?.title.value).toBe('Printer');
        expect(loaded?.status).toBe('open');
        expect(loaded?.createdAt.toISOString()).toBe('2026-01-01T10:00:00.000Z');
        expect(loaded?.closedAt).toBeUndefined();
    });

    it('updates an existing ticket through MERGE', async () => {
        // Arrange
        const ticket = await openTicket('00000000-0000-4000-8000-000000000002', 'Scanner', 1);
        ticket.close('bob', new Date(Date.UTC(2026, 0, 2, 9, 30)));

        // Act
        await repository.save(ticket, { actor: 'bob' });

        // Assert
        const summary = await queries.findById(ticket.id);
        expect(summary).toMatchObject({
            status: 'closed',
            closedAt: '2026-01-02T09:30:00.000Z',
            createdBy: 'alice',
        });
    });

    it('pages a filtered list with the whitelisted ORDER BY and reports next/prev', async () => {
        // Arrange
        const titles = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
        for (const [i, title] of titles.entries()) {
            await openTicket(`00000000-0000-4000-8000-00000000001${i}`, title, i);
        }
        const closed = await openTicket('00000000-0000-4000-8000-000000000020', 'Aardvark', 9);
        closed.close('bob', new Date(Date.UTC(2026, 0, 3)));
        await repository.save(closed);

        // Act
        const page = await queries.list(
            { status: 'open' },
            { page: 2, size: 2, orderBy: 'title:asc' },
            { actor: 'alice' },
        );

        // Assert
        expect(page.data.map((t) => t.title)).toEqual(['Charlie', 'Delta']);
        expect(page.meta).toEqual({ hasNext: true, hasPrev: true });
    });

    it('returns an empty last page without a next page', async () => {
        // Arrange
        await openTicket('00000000-0000-4000-8000-000000000030', 'Only', 0);

        // Act
        const page = await queries.list({}, { page: 2, size: 1, orderBy: 'createdAt:desc' });

        // Assert
        expect(page).toEqual({ data: [], meta: { hasNext: false, hasPrev: true } });
    });
});
