import type { AccountQueryPort, AccountSummary, QueryOptions } from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { AccountMapper, type AccountRow } from '@infrastructure/database/mappers/account.mapper';
import { DatabaseSources } from '@infrastructure/database/sources';
import oracledb, { type Connection, type ResultSet } from 'oracledb';

/** Procedure with an OUT SYS_REFCURSOR: rows are read from the returned result set. */
const LIST_ACCOUNTS = `
    BEGIN
        account_api.list_accounts(p_status_code => :statusCode, o_accounts => :accounts);
    END;`;

/** Scalar function: assign its return value to an OUT bind. */
const GET_BALANCE = `
    BEGIN
        :balance := account_api.get_balance(p_account_id => :accountId);
    END;`;

const FETCH_ROWS = 100;

export class AccountApiQueryDao implements AccountQueryPort {
    constructor(private readonly db: ConnectionProvider) {}

    listByStatus(
        status: AccountSummary['status'],
        options?: QueryOptions,
    ): Promise<AccountSummary[]> {
        return this.db.withConnection<AccountSummary[], Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { outBinds } = await connection.execute<{ accounts: ResultSet<AccountRow> }>(
                    LIST_ACCOUNTS,
                    {
                        statusCode: AccountMapper.toStatusCode(status),
                        accounts: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
                    },
                    // applies to the cursor's rows too
                    { outFormat: oracledb.OUT_FORMAT_OBJECT },
                );
                const cursor = outBinds!.accounts;
                const accounts: AccountSummary[] = [];
                try {
                    let rows: AccountRow[];
                    do {
                        rows = await cursor.getRows(FETCH_ROWS);
                        accounts.push(...rows.map((row) => AccountMapper.toSummary(row)));
                    } while (rows.length === FETCH_ROWS);
                } finally {
                    await cursor.close(); // always close cursors, or the session leaks open cursors
                }
                return accounts;
            },
            { contextUser: options?.actor, tag: 'accounts.listByStatus' },
        );
    }

    getBalance(accountId: string, options?: QueryOptions): Promise<number | undefined> {
        return this.db.withConnection<number | undefined, Connection>(
            DatabaseSources.main,
            async (connection) => {
                const { outBinds } = await connection.execute<{ balance: number | null }>(
                    GET_BALANCE,
                    {
                        accountId,
                        balance: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
                    },
                );
                return outBinds!.balance ?? undefined; // the function returns NULL for unknown ids
            },
            { contextUser: options?.actor, tag: 'accounts.getBalance' },
        );
    }
}
