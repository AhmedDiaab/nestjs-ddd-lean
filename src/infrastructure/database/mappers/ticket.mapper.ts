import type { TicketSummary } from '@application/ports';
import { Ticket, TicketTitle, type TicketStatus } from '@domain';

/** Column names as returned with outFormat OBJECT (Oracle upper-cases unquoted aliases). */
export type TicketRow = {
    ID: string;
    TITLE: string;
    STATUS: TicketStatus;
    CREATED_BY: string;
    CREATED_AT: Date;
    CLOSED_AT: Date | null;
};

export const TicketMapper = {
    toDomain(row: TicketRow): Ticket {
        const title = TicketTitle.create(row.TITLE);
        if (!title.ok) {
            // stored data violates a domain rule: fail loudly instead of hiding it
            throw new Error(`Corrupt ticket row ${row.ID}: ${title.error.message}`);
        }
        return Ticket.restore(row.ID, {
            title: title.value,
            status: row.STATUS,
            createdBy: row.CREATED_BY,
            createdAt: row.CREATED_AT,
            closedAt: row.CLOSED_AT ?? undefined,
        });
    },

    toBinds(ticket: Ticket) {
        return {
            id: ticket.id,
            title: ticket.title.value,
            status: ticket.status,
            createdBy: ticket.createdBy,
            createdAt: ticket.createdAt,
            closedAt: ticket.closedAt ?? null,
        };
    },

    toSummary(row: TicketRow): TicketSummary {
        return {
            id: row.ID,
            title: row.TITLE,
            status: row.STATUS,
            createdBy: row.CREATED_BY,
            createdAt: row.CREATED_AT.toISOString(),
            closedAt: row.CLOSED_AT ? row.CLOSED_AT.toISOString() : null,
        };
    },
};
