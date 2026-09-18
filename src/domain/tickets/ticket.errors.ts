import { DomainError } from '@domain/errors';
import { ProblemTypes, type ProblemLike } from '@shared';

export class TicketAlreadyClosedError extends DomainError {
    constructor(public readonly ticketId: string) {
        super(`Ticket ${ticketId} is already closed`);
    }

    override toProblem(): ProblemLike {
        return {
            kind: 'conflict', // → HTTP 409
            type: ProblemTypes.Conflict,
            title: 'Ticket already closed',
            detail: this.message,
        };
    }
}
