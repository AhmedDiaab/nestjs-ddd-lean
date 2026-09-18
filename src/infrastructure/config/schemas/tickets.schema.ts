import { z } from 'zod';

export const ticketsSchema = z.object({
    /** Upper bound for GET /tickets?size= */
    maxPageSize: z.coerce.number().int().min(1).max(500).default(100),
    /** Allow closing tickets opened by other users */
    allowCloseByOthers: z.boolean().default(true),
});

export type TicketsConfig = z.infer<typeof ticketsSchema>;
