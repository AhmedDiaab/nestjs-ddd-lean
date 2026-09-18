import {
    AccountQueryPortToken,
    type AccountQueryPort,
    type AccountSummary,
} from '@application/ports';
import { UseCase } from '@common/base';
import { Inject, Injectable } from '@nestjs/common';
import type { Result } from '@shared';

type Input = { status: AccountSummary['status']; username: string };

@Injectable()
export class ListAccountsUseCase extends UseCase<Input, AccountSummary[], never> {
    constructor(@Inject(AccountQueryPortToken) private readonly accounts: AccountQueryPort) {
        super();
    }

    async execute(input: Input): Promise<Result<AccountSummary[], never>> {
        const accounts = await this.accounts.listByStatus(input.status, { actor: input.username });
        return this.ok(accounts);
    }
}
