import {
    TicketQueryPortToken,
    type TicketListFilter,
    type TicketQueryPort,
    type TicketSort,
    type TicketSummary,
} from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';
import type { OffsetRequest, PageEnvelope } from '@shared/pagination';

type Input = { filter: TicketListFilter; page: OffsetRequest<TicketSort>; username: string };
type Output = PageEnvelope<TicketSummary>;

@Injectable()
export class ListTicketsUseCase extends UseCase<Input, Output, never> {
    constructor(@Inject(TicketQueryPortToken) private readonly queries: TicketQueryPort) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, never>> {
        return this.ok(
            await this.queries.list(input.filter, input.page, { actor: input.username }),
        );
    }
}
