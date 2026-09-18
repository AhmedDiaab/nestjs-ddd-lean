import { Ticket, TicketAlreadyClosedError, TicketTitle, ValidationError } from '@domain';

const title = (raw = 'Printer is down') => {
    const result = TicketTitle.create(raw);
    if (!result.ok) throw result.error;
    return result.value;
};

describe('TicketTitle', () => {
    it('trims the value', () => {
        // Arrange
        const raw = '  Printer  ';

        // Act
        const result = TicketTitle.create(raw);

        // Assert
        expect(result.ok && result.value.value).toBe('Printer');
    });

    it.each(['', '   ', 'x'.repeat(TicketTitle.MAX_LENGTH + 1)])('rejects %p', (raw) => {
        // Arrange: raw from table

        // Act
        const result = TicketTitle.create(raw);

        // Assert
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toBeInstanceOf(ValidationError);
    });

    it('compares by value', () => {
        // Arrange
        const a = title('A');
        const trimmedA = title(' A ');

        // Act
        const equal = a.equals(trimmedA);

        // Assert
        expect(equal).toBe(true);
    });
});

describe('Ticket', () => {
    const now = new Date('2026-01-01T10:00:00Z');
    const open = () => Ticket.open({ id: 't-1', title: title(), createdBy: 'alice', now });

    it('opens with status open', () => {
        // Arrange
        const input = { id: 't-1', title: title(), createdBy: 'alice', now };

        // Act
        const ticket = Ticket.open(input);

        // Assert
        expect(ticket.status).toBe('open');
    });

    it('closes once', () => {
        // Arrange
        const ticket = open();
        const later = new Date('2026-01-02T10:00:00Z');

        // Act
        const result = ticket.close('bob', later);

        // Assert
        expect(result.ok).toBe(true);
        expect(ticket.status).toBe('closed');
        expect(ticket.closedAt).toEqual(later);
    });

    it('refuses to close twice', () => {
        // Arrange
        const ticket = open();
        ticket.close('bob', now);

        // Act
        const second = ticket.close('bob', now);

        // Assert
        expect(!second.ok && second.error).toBeInstanceOf(TicketAlreadyClosedError);
    });
});
