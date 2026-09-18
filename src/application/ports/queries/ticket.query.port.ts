import { createToken } from '@shared';
import type { OffsetRequest, PageEnvelope } from '@shared/pagination';
import type { QueryOptions } from './query-options';

/** Read model: shaped for API responses, not a domain entity. */
export type TicketSummary = {
    id: string;
    title: string;
    status: 'open' | 'closed';
    createdBy: string;
    createdAt: string; // ISO-8601
    closedAt: string | null;
};

export type TicketListFilter = {
    status?: 'open' | 'closed';
};

export type TicketSort = 'createdAt:desc' | 'createdAt:asc' | 'title:asc' | 'title:desc';

export interface TicketQueryPort {
    findById(id: string, options?: QueryOptions): Promise<TicketSummary | undefined>;
    list(
        filter: TicketListFilter,
        page: OffsetRequest<TicketSort>,
        options?: QueryOptions,
    ): Promise<PageEnvelope<TicketSummary>>;
}

export const TicketQueryPortToken = createToken<TicketQueryPort>('TicketQueryPort');
