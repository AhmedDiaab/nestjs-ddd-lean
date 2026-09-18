import { createToken } from '@shared';
import type { QueryOptions } from './query-options';

/** Read model: what our API returns, not the other team's column layout. */
export type AccountSummary = {
    id: string;
    holder: string;
    status: 'active' | 'suspended';
    openedAt: string; // ISO-8601
};

export interface AccountQueryPort {
    listByStatus(
        status: AccountSummary['status'],
        options?: QueryOptions,
    ): Promise<AccountSummary[]>;
    /** `undefined` when the account doesn't exist. */
    getBalance(accountId: string, options?: QueryOptions): Promise<number | undefined>;
}

export const AccountQueryPortToken = createToken<AccountQueryPort>('AccountQueryPort');
