import {
    AccountGatewayToken,
    type AccountGateway,
    type SuspendAccountFailure,
} from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { accountId: string; reason: string; username: string };
type Output = { accountId: string; status: string };

/** The DB team's procedure owns the suspension rules; the use case passes the request through. */
@Injectable()
export class SuspendAccountUseCase extends UseCase<Input, Output, SuspendAccountFailure> {
    constructor(@Inject(AccountGatewayToken) private readonly accounts: AccountGateway) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, SuspendAccountFailure>> {
        const result = await this.accounts.suspend(
            { accountId: input.accountId, reason: input.reason },
            { actor: input.username },
        );
        if (!result.ok) return result; // 404 / 409 from the procedure's error codes
        return this.ok({ accountId: input.accountId, status: result.value.status });
    }
}
