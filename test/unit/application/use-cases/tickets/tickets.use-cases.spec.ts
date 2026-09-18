import { NotFoundError } from '@application/errors';
import { CloseTicketUseCase, OpenTicketUseCase } from '@application/use-cases';
import { TicketAlreadyClosedError, ValidationError } from '@domain';
import { InMemoryTickets } from '../../../../fakes/in-memory-tickets';

describe('ticket use cases', () => {
    let tickets: InMemoryTickets;
    let openTicket: OpenTicketUseCase;
    let closeTicket: CloseTicketUseCase;

    beforeEach(() => {
        tickets = new InMemoryTickets();
        openTicket = new OpenTicketUseCase(tickets.repository);
        closeTicket = new CloseTicketUseCase(tickets.repository);
    });

    const openExisting = async () => {
        const opened = await openTicket.execute({ title: 'Printer', username: 'alice' });
        return opened.ok ? opened.value.id : '';
    };

    it('opens a ticket and saves it as the acting user', async () => {
        // Arrange
        const input = { title: 'Printer', username: 'alice' };

        // Act
        const result = await openTicket.execute(input);

        // Assert
        expect(result.ok).toBe(true);
        const id = result.ok ? result.value.id : '';
        expect(tickets.store.get(id)?.createdBy).toBe('alice');
        expect(tickets.actors).toEqual(['alice']);
    });

    it('returns a ValidationError for an empty title without saving', async () => {
        // Arrange
        const input = { title: ' ', username: 'alice' };

        // Act
        const result = await openTicket.execute(input);

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
        expect(tickets.store.size).toBe(0);
    });

    it('closes an open ticket', async () => {
        // Arrange
        const id = await openExisting();

        // Act
        const result = await closeTicket.execute({ id, username: 'bob' });

        // Assert
        expect(result).toEqual({ ok: true, value: { id, status: 'closed' } });
        expect(tickets.store.get(id)?.status).toBe('closed');
    });

    it('returns NotFoundError for an unknown ticket', async () => {
        // Arrange
        const input = { id: 'missing', username: 'bob' };

        // Act
        const result = await closeTicket.execute(input);

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    });

    it('returns TicketAlreadyClosedError when closing twice', async () => {
        // Arrange
        const id = await openExisting();
        await closeTicket.execute({ id, username: 'bob' });

        // Act
        const result = await closeTicket.execute({ id, username: 'bob' });

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(TicketAlreadyClosedError);
    });
});
