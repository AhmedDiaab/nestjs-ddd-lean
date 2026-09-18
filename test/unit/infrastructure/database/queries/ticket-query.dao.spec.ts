import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { TicketQueryDao } from '@infrastructure/database/queries';

const row = (id: string) => ({
    ID: id,
    TITLE: `Ticket ${id}`,
    STATUS: 'open',
    CREATED_BY: 'alice',
    CREATED_AT: new Date('2026-01-01T00:00:00Z'),
    CLOSED_AT: null,
});

describe('TicketQueryDao.list', () => {
    const connection = { execute: jest.fn() };
    const db = {
        withConnection: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };
    const sut = new TicketQueryDao(db as unknown as ConnectionProvider);

    afterEach(() => jest.clearAllMocks());

    it('fetches size + 1 rows to compute hasNext and uses fixed ORDER BY SQL', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({ rows: [row('1'), row('2'), row('3')] });
        const pageRequest = { page: 2, size: 2, orderBy: 'title:asc' } as const;

        // Act
        const page = await sut.list({}, pageRequest, { actor: 'bob' });

        // Assert
        expect(page.data.map((t) => t.id)).toEqual(['1', '2']);
        expect(page.meta).toEqual({ hasNext: true, hasPrev: true });
        const [sql, binds] = connection.execute.mock.calls[0] as [string, Record<string, unknown>];
        expect(sql).toContain('ORDER BY title ASC, id ASC');
        expect(binds).toEqual({ status: null, rowOffset: 2, rowLimit: 3 });
    });
});
