/**
 * Contract with the DB team's `account_api` package: the codes its procedures raise with
 * RAISE_APPLICATION_ERROR. Keep this file in sync with their documentation.
 */
export const AccountApiErrorCodes = {
    accountNotFound: 'ORA-20001',
    alreadySuspended: 'ORA-20002',
} as const;
