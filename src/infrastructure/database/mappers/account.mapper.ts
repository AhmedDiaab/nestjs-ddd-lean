import type { AccountSummary } from '@application/ports';

/**
 * Columns of the DB team's `account_api.list_accounts` cursor. Their names and codes stay here:
 * if the other team renames a column or adds a status code, only this mapper changes.
 */
export type AccountRow = {
    ACCOUNT_ID: string;
    HOLDER_NAME: string;
    STATUS_CODE: 'A' | 'S';
    OPENED_ON: Date;
};

const STATUS: Record<AccountRow['STATUS_CODE'], AccountSummary['status']> = {
    A: 'active',
    S: 'suspended',
};

export const AccountMapper = {
    toSummary(row: AccountRow): AccountSummary {
        return {
            id: row.ACCOUNT_ID,
            holder: row.HOLDER_NAME,
            status: STATUS[row.STATUS_CODE],
            openedAt: row.OPENED_ON.toISOString(),
        };
    },

    toStatusCode(status: AccountSummary['status']): AccountRow['STATUS_CODE'] {
        return status === 'active' ? 'A' : 'S';
    },
};
