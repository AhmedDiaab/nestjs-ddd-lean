import { UseCase } from '@common/base';
import {
    Ticket,
    TicketRepositoryToken,
    TicketTitle,
    type TicketRepository,
    type ValidationError,
} from '@domain';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { title: string; username: string };
type Output = { id: string };

@Injectable()
export class OpenTicketUseCase extends UseCase<Input, Output, ValidationError> {
    constructor(@Inject(TicketRepositoryToken) private readonly tickets: TicketRepository) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, ValidationError>> {
        const title = TicketTitle.create(input.title);
        if (!title.ok) return this.err(title.error); // → 422 with field errors

        const ticket = Ticket.open({
            id: this.tickets.nextId(),
            title: title.value,
            createdBy: input.username,
            now: new Date(),
        });

        await this.tickets.save(ticket, { actor: input.username });
        return this.ok({ id: ticket.id });
    }
}
