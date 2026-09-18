import { createToken } from '@shared';
import type { Ticket } from '../tickets';

export type RepositoryOptions = {
    /** Who performs the change (username). Persisted for audit; Oracle adapters send it as CLIENT_IDENTIFIER. */
    actor?: string;
};

/** Collection-like access to the Ticket aggregate. Implemented in infrastructure. */
export interface TicketRepository {
    nextId(): string;
    findById(id: string, options?: RepositoryOptions): Promise<Ticket | undefined>;
    save(ticket: Ticket, options?: RepositoryOptions): Promise<void>;
}

export const TicketRepositoryToken = createToken<TicketRepository>('TicketRepository');
