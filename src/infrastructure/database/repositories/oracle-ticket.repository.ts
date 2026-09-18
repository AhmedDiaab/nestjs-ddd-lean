import { randomUUID } from 'node:crypto';
import type { RepositoryOptions, Ticket, TicketRepository } from '@domain';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { TicketMapper, type TicketRow } from '@infrastructure/database/mappers/ticket.mapper';
import { DatabaseSources } from '@infrastructure/database/sources';
import oracledb, { type Connection } from 'oracledb';

const SELECT_BY_ID = `
    SELECT id, title, status, created_by, created_at, closed_at
    FROM tickets
    WHERE id = :id
`;

const UPSERT = `
    MERGE INTO tickets t
    USING (SELECT :id AS id FROM dual) s
    ON (t.id = s.id)
    WHEN MATCHED THEN UPDATE SET
        t.title = :title,
        t.status = :status,
        t.closed_at = :closedAt
    WHEN NOT MATCHED THEN INSERT (id, title, status, created_by, created_at, closed_at)
        VALUES (:id, :title, :status, :createdBy, :createdAt, :closedAt)
`;

export class OracleTicketRepository implements TicketRepository {
    constructor(private readonly db: ConnectionProvider) {}

    nextId(): string {
        return randomUUID();
    }

    findById(id: string, options?: RepositoryOptions): Promise<Ticket | undefined> {
        return this.db.withConnection<Ticket | undefined, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { rows } = await connection.execute<TicketRow>(
                    SELECT_BY_ID,
                    { id },
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const [row] = rows ?? [];
                return row ? TicketMapper.toDomain(row) : undefined;
            },
            { contextUser: options?.actor, tag: 'tickets.findById' },
        );
    }

    save(ticket: Ticket, options?: RepositoryOptions): Promise<void> {
        // transaction(): commit on success, rollback on error, one connection
        return this.db.transaction<void, Connection>(
            DatabaseSources.main,
            async (connection) => {
                await connection.execute(UPSERT, TicketMapper.toBinds(ticket));
            },
            { contextUser: options?.actor, tag: 'tickets.save' },
        );
    }
}
