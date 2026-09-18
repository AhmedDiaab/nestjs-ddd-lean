import type {
    QueryOptions,
    TicketListFilter,
    TicketQueryPort,
    TicketSort,
    TicketSummary,
} from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { TicketMapper, type TicketRow } from '@infrastructure/database/mappers/ticket.mapper';
import { DatabaseSources } from '@infrastructure/database/sources';
import type { OffsetRequest, PageEnvelope } from '@shared/pagination';
import oracledb, { type Connection } from 'oracledb';

/**
 * Sort keys map to fixed SQL: never interpolate client input into ORDER BY.
 * Bind names avoid SQL keywords (:offset/:fetch can raise ORA-01745).
 */
const ORDER_BY: Record<TicketSort, string> = {
    'createdAt:desc': 'created_at DESC, id DESC',
    'createdAt:asc': 'created_at ASC, id ASC',
    'title:asc': 'title ASC, id ASC',
    'title:desc': 'title DESC, id DESC',
};

const COLUMNS = 'id, title, status, created_by, created_at, closed_at';

export class TicketQueryDao implements TicketQueryPort {
    constructor(private readonly db: ConnectionProvider) {}

    findById(id: string, options?: QueryOptions): Promise<TicketSummary | undefined> {
        return this.db.withConnection<TicketSummary | undefined, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows } = await connection.execute<TicketRow>(
                    `SELECT ${COLUMNS} FROM tickets WHERE id = :id`,
                    { id },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const [row] = rows ?? [];
                return row ? TicketMapper.toSummary(row) : undefined;
            },
            { contextUser: options?.actor, tag: 'tickets.query.findById' },
        );
    }

    list(
        filter: TicketListFilter,
        page: OffsetRequest<TicketSort>,
        options?: QueryOptions,
    ): Promise<PageEnvelope<TicketSummary>> {
        const sql = `
            SELECT ${COLUMNS}
            FROM tickets
            WHERE (:status IS NULL OR status = :status)
            ORDER BY ${ORDER_BY[page.orderBy]}
            OFFSET :rowOffset ROWS FETCH NEXT :rowLimit ROWS ONLY
        `;

        return this.db.withConnection<PageEnvelope<TicketSummary>, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows = [] } = await connection.execute<TicketRow>(
                    sql,
                    {
                        status: filter.status ?? null,
                        rowOffset: (page.page - 1) * page.size,
                        rowLimit: page.size + 1, // one extra row tells us if there is a next page
                    },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                return {
                    data: rows.slice(0, page.size).map((row) => TicketMapper.toSummary(row)),
                    meta: { hasNext: rows.length > page.size, hasPrev: page.page > 1 },
                };
            },
            { contextUser: options?.actor, tag: 'tickets.query.list' },
        );
    }
}
