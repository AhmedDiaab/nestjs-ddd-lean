import { NotFoundError } from '@application/errors';
import { TicketQueryPortToken, type TicketQueryPort, type TicketSummary } from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { id: string; username: string };

@Injectable()
export class GetTicketUseCase extends UseCase<Input, TicketSummary, NotFoundError> {
    constructor(@Inject(TicketQueryPortToken) private readonly queries: TicketQueryPort) {
        super();
    }

    async execute(input: Input): Promise<Result<TicketSummary, NotFoundError>> {
        const ticket = await this.queries.findById(input.id, { actor: input.username });
        return ticket
            ? this.ok(ticket)
            : this.err(new NotFoundError(`Ticket ${input.id} not found`));
    }
}
