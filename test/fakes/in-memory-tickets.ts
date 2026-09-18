import { randomUUID } from 'node:crypto';
import type { TicketQueryPort, TicketSummary } from '@application/ports';
import { Ticket, type RepositoryOptions, type TicketRepository } from '@domain';

/**
 * In-memory stand-in for the tickets table.
 * `repository` implements the domain port, `queries` the read port; both share one store.
 */
export class InMemoryTickets {
    readonly store = new Map<string, Ticket>();
    readonly actors: (string | undefined)[] = [];

    readonly repository: TicketRepository = {
        nextId: () => randomUUID(),
        // copies in and out, like a database: changing a loaded ticket doesn't change the store until save
        findById: (id) => {
            const stored = this.store.get(id);
            return Promise.resolve(stored ? copy(stored) : undefined);
        },
        save: (ticket: Ticket, options?: RepositoryOptions) => {
            this.actors.push(options?.actor);
            this.store.set(ticket.id, copy(ticket));
            return Promise.resolve();
        },
    };

    readonly queries: TicketQueryPort = {
        findById: (id) => {
            const ticket = this.store.get(id);
            return Promise.resolve(ticket ? toSummary(ticket) : undefined);
        },
        list: (filter, page) => {
            const all = [...this.store.values()]
                .filter((t) => !filter.status || t.status === filter.status)
                .map(toSummary);
            const start = (page.page - 1) * page.size;
            return Promise.resolve({
                data: all.slice(start, start + page.size),
                meta: { hasNext: all.length > start + page.size, hasPrev: page.page > 1 },
            });
        },
    };
}

function toSummary(ticket: Ticket): TicketSummary {
    return {
        id: ticket.id,
        title: ticket.title.value,
        status: ticket.status,
        createdBy: ticket.createdBy,
        createdAt: ticket.createdAt.toISOString(),
        closedAt: ticket.closedAt?.toISOString() ?? null,
    };
}

function copy(ticket: Ticket): Ticket {
    return Ticket.restore(ticket.id, {
        title: ticket.title,
        status: ticket.status,
        createdBy: ticket.createdBy,
        createdAt: ticket.createdAt,
        closedAt: ticket.closedAt,
    });
}
