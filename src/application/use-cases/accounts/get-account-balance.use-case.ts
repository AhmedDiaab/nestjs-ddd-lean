import { NotFoundError } from '@application/errors';
import { AccountQueryPortToken, type AccountQueryPort } from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { accountId: string; username: string };
type Output = { accountId: string; balance: number };

@Injectable()
export class GetAccountBalanceUseCase extends UseCase<Input, Output, NotFoundError> {
    constructor(@Inject(AccountQueryPortToken) private readonly accounts: AccountQueryPort) {
        super();
    }

    async execute(input: Input): Promise<Result<Output, NotFoundError>> {
        const balance = await this.accounts.getBalance(input.accountId, { actor: input.username });
        if (balance === undefined) {
            return this.err(new NotFoundError(`Account ${input.accountId} not found`));
        }
        return this.ok({ accountId: input.accountId, balance });
    }
}
