import type { ConflictError, NotFoundError } from '@application/errors';
import { createToken, type Result } from '@shared';

export type SuspendAccountCommand = {
    accountId: string;
    reason: string;
};

export type SuspendAccountFailure = NotFoundError | ConflictError;

export type GatewayOptions = {
    /** Username for DB auditing (Oracle CLIENT_IDENTIFIER). */
    actor?: string;
};

/**
 * Actions another team's database performs for us (their procedures enforce the rules).
 * Expected refusals come back as failed Results; the adapter maps the procedure's error codes.
 */
export interface AccountGateway {
    suspend(
        command: SuspendAccountCommand,
        options?: GatewayOptions,
    ): Promise<Result<{ status: string }, SuspendAccountFailure>>;
}

export const AccountGatewayToken = createToken<AccountGateway>('AccountGateway');
