import { z } from 'zod';
import { OffsetQuerySchema } from './pagination.schema';

export const openTicketBodySchema = z.object({
    title: z.string(), // business rules (trim, length) live in the TicketTitle value object
});
export type OpenTicketBody = z.infer<typeof openTicketBodySchema>;

export const ticketIdParamsSchema = z.object({
    id: z.uuid(),
});
export type TicketIdParams = z.infer<typeof ticketIdParamsSchema>;

export const listTicketsQuerySchema = OffsetQuerySchema.extend({
    status: z.enum(['open', 'closed']).optional(),
    orderBy: z
        .enum(['createdAt:desc', 'createdAt:asc', 'title:asc', 'title:desc'])
        .default('createdAt:desc'),
});
export type ListTicketsQuery = z.infer<typeof listTicketsQuerySchema>;

/** Response shapes, used for Swagger docs only (use cases return plain read models). */
export const ticketSummarySchema = z.object({
    id: z.uuid(),
    title: z.string(),
    status: z.enum(['open', 'closed']),
    createdBy: z.string(),
    createdAt: z.iso.datetime(),
    closedAt: z.iso.datetime().nullable(),
});

export const ticketPageSchema = z.object({
    data: z.array(ticketSummarySchema),
    meta: z.object({ hasNext: z.boolean(), hasPrev: z.boolean().optional() }),
});

export const ticketIdSchema = z.object({ id: z.uuid() });

export const closedTicketSchema = z.object({ id: z.uuid(), status: z.literal('closed') });
