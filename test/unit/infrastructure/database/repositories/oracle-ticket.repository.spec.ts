import { Ticket, TicketTitle } from '@domain';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { OracleTicketRepository } from '@infrastructure/database/repositories';

describe('OracleTicketRepository', () => {
    const connection = { execute: jest.fn() };
    const db = {
        withConnection: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
        transaction: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };
    const sut = new OracleTicketRepository(db as unknown as ConnectionProvider);

    afterEach(() => jest.clearAllMocks());

    it('maps a row to the Ticket aggregate and passes the actor as context user', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({
            rows: [
                {
                    ID: 't-1',
                    TITLE: 'Printer',
                    STATUS: 'open',
                    CREATED_BY: 'alice',
                    CREATED_AT: new Date('2026-01-01T00:00:00Z'),
                    CLOSED_AT: null,
                },
            ],
        });

        // Act
        const ticket = await sut.findById('t-1', { actor: 'bob' });

        // Assert
        expect(ticket).toBeInstanceOf(Ticket);
        expect(ticket?.title.value).toBe('Printer');
        expect(db.withConnection).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'bob',
            tag: 'tickets.findById',
        });
    });

    it('returns undefined when no row matches', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({ rows: [] });

        // Act
        const ticket = await sut.findById('missing');

        // Assert
        expect(ticket).toBeUndefined();
    });

    it('saves inside a transaction with bind values from the aggregate', async () => {
        // Arrange
        const title = TicketTitle.create('Printer');
        if (!title.ok) throw title.error;
        const ticket = Ticket.open({
            id: 't-1',
            title: title.value,
            createdBy: 'alice',
            now: new Date('2026-01-01T00:00:00Z'),
        });

        // Act
        await sut.save(ticket, { actor: 'alice' });

        // Assert
        expect(db.transaction).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'alice',
            tag: 'tickets.save',
        });
        expect(connection.execute).toHaveBeenCalledWith(
            expect.stringContaining('MERGE INTO tickets'),
            expect.objectContaining({
                id: 't-1',
                title: 'Printer',
                status: 'open',
                closedAt: null,
            }),
        );
    });
});
