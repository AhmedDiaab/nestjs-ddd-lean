import { NotFoundError } from '@application/errors';
import { UseCase } from '@common/base';
import {
    TicketRepositoryToken,
    type TicketAlreadyClosedError,
    type TicketRepository,
} from '@domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { id: string; username: string };
type Output = { id: string; status: 'closed' };
type Failure = NotFoundError | TicketAlreadyClosedError;

@Injectable()
export class CloseTicketUseCase extends UseCase<Input, Output, Failure> {
    constructor(@Inject(TicketRepositoryToken) private readonly tickets: TicketRepository) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, Failure>> {
        const options = { actor: input.username };

        const ticket = await this.tickets.findById(input.id, options);
        if (!ticket) return this.err(new NotFoundError(`Ticket ${input.id} not found`)); // → 404

        const closed = ticket.close(input.username, new Date());
        if (!closed.ok) return this.err(closed.error); // → 409

        await this.tickets.save(ticket, options);
        return this.ok({ id: ticket.id, status: 'closed' });
    }
}
