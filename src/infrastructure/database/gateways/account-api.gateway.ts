import { ConflictError, NotFoundError } from '@application/errors';
import type {
    AccountGateway,
    GatewayOptions,
    SuspendAccountCommand,
    SuspendAccountFailure,
} from '@application/ports';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseExecutionError } from '@infrastructure/database/errors';
import { DatabaseSources } from '@infrastructure/database/sources';
import { Result } from '@shared';
import oracledb, { type Connection } from 'oracledb';
import { AccountApiErrorCodes } from './account-api.constants';

/** Named parameters (`p_x => :x`) keep working if the DB team reorders the signature. */
const SUSPEND_ACCOUNT = `
    BEGIN
        account_api.suspend_account(
            p_account_id => :accountId,
            p_reason     => :reason,
            o_status     => :status
        );
    END;`;

type SuspendOutBinds = { status: string };

/** Calls the DB team's procedures; their rules decide, this adapter only translates. */
export class AccountApiGateway implements AccountGateway {
    constructor(private readonly db: ConnectionProvider) {}

    async suspend(
        command: SuspendAccountCommand,
        options?: GatewayOptions,
    ): Promise<Result<{ status: string }, SuspendAccountFailure>> {
        try {
            // transaction(): commits our call; harmless if the procedure commits itself
            const status = await this.db.transaction<string, Connection>(
                DatabaseSources.main,
                async (connection) => {
                    const { outBinds } = await connection.execute<SuspendOutBinds>(
                        SUSPEND_ACCOUNT,
                        {
                            accountId: command.accountId,
                            reason: command.reason,
                            status: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 20 },
                        },
                    );
                    return outBinds!.status;
                },
                { contextUser: options?.actor, tag: 'accounts.suspend' },
            );
            return Result.ok({ status });
        } catch (error) {
            const failure = toSuspendFailure(error, command.accountId);
            if (failure) return Result.err(failure);
            throw error; // anything else is unexpected → 500/503
        }
    }
}

/** The procedure's documented refusals become application errors (404, 409). */
function toSuspendFailure(error: unknown, accountId: string): SuspendAccountFailure | undefined {
    if (!(error instanceof DatabaseExecutionError)) return undefined;
    switch (error.code) {
        case AccountApiErrorCodes.accountNotFound:
            return new NotFoundError(`Account ${accountId} not found`);
        case AccountApiErrorCodes.alreadySuspended:
            return new ConflictError(`Account ${accountId} is already suspended`);
        default:
            return undefined;
    }
}
