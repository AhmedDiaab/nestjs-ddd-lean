/**
 * Live Oracle checks for adapters over a database we don't own: the procedures, cursor and
 * function of an `account_api` package. The DB team's objects are simulated by a stub package
 * and table created here and dropped afterwards. Skipped unless ORACLE_IT_PASSWORD is set.
 */
import { ConflictError, NotFoundError } from '@application/errors';
import type { LoggerPort } from '@application/ports';
import { databaseConfigSchema } from '@infrastructure/config/schemas';
import { PoolManager } from '@infrastructure/database/connection';
import { AccountApiGateway } from '@infrastructure/database/gateways';
import { AccountApiQueryDao } from '@infrastructure/database/queries';
import type { BindParameters, Connection } from 'oracledb';

const password = process.env.ORACLE_IT_PASSWORD;
const describeLive = password ? describe : describe.skip;

const STUB_OBJECTS = [
    `CREATE TABLE account_api_it_accounts (
        account_id       VARCHAR2(36) PRIMARY KEY,
        holder_name      VARCHAR2(100) NOT NULL,
        status_code      CHAR(1) NOT NULL,
        opened_on        DATE NOT NULL,
        balance          NUMBER(12, 2) NOT NULL,
        suspended_reason VARCHAR2(200),
        suspended_by     VARCHAR2(64)
    )`,
    `CREATE OR REPLACE PACKAGE account_api AS
        PROCEDURE suspend_account(p_account_id IN VARCHAR2, p_reason IN VARCHAR2, o_status OUT VARCHAR2);
        PROCEDURE list_accounts(p_status_code IN VARCHAR2, o_accounts OUT SYS_REFCURSOR);
        FUNCTION get_balance(p_account_id IN VARCHAR2) RETURN NUMBER;
    END account_api;`,
    `CREATE OR REPLACE PACKAGE BODY account_api AS
        PROCEDURE suspend_account(p_account_id IN VARCHAR2, p_reason IN VARCHAR2, o_status OUT VARCHAR2) IS
            v_status account_api_it_accounts.status_code%TYPE;
        BEGIN
            SELECT status_code INTO v_status FROM account_api_it_accounts
             WHERE account_id = p_account_id FOR UPDATE;
            IF v_status = 'S' THEN
                RAISE_APPLICATION_ERROR(-20002, 'Account already suspended');
            END IF;
            UPDATE account_api_it_accounts
               SET status_code = 'S',
                   suspended_reason = p_reason,
                   suspended_by = SYS_CONTEXT('USERENV', 'CLIENT_IDENTIFIER')
             WHERE account_id = p_account_id;
            o_status := 'SUSPENDED';
        EXCEPTION
            WHEN NO_DATA_FOUND THEN
                RAISE_APPLICATION_ERROR(-20001, 'Account not found');
        END;

        PROCEDURE list_accounts(p_status_code IN VARCHAR2, o_accounts OUT SYS_REFCURSOR) IS
        BEGIN
            OPEN o_accounts FOR
                SELECT account_id, holder_name, status_code, opened_on
                  FROM account_api_it_accounts
                 WHERE status_code = p_status_code
                 ORDER BY account_id;
        END;

        FUNCTION get_balance(p_account_id IN VARCHAR2) RETURN NUMBER IS
            v_balance NUMBER;
        BEGIN
            SELECT balance INTO v_balance FROM account_api_it_accounts WHERE account_id = p_account_id;
            RETURN v_balance;
        EXCEPTION
            WHEN NO_DATA_FOUND THEN RETURN NULL;
        END;
    END account_api;`,
];

describeLive('Adapters over a database owned by another team (live Oracle)', () => {
    const logger: LoggerPort = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    };
    const db = new PoolManager(logger);
    const gateway = new AccountApiGateway(db);
    const queries = new AccountApiQueryDao(db);

    const execute = (sql: string, binds: BindParameters = {}) =>
        db.transaction('main', (conn: Connection) => conn.execute(sql, binds));

    beforeAll(async () => {
        await db.init(
            databaseConfigSchema.parse({
                sources: [
                    {
                        key: 'main',
                        dialect: 'oracle',
                        connectString:
                            process.env.ORACLE_IT_CONNECT_STRING ?? 'localhost:1521/FREEPDB1',
                        user: process.env.ORACLE_IT_USER ?? 'app',
                        password,
                    },
                ],
                health: {},
            }),
        );
        for (const ddl of STUB_OBJECTS) await execute(ddl);
    });

    afterAll(async () => {
        await execute('DROP PACKAGE account_api').catch(() => undefined);
        await execute('DROP TABLE account_api_it_accounts PURGE').catch(() => undefined);
        await db.onModuleDestroy();
    });

    beforeEach(async () => {
        await execute('DELETE FROM account_api_it_accounts');
        await execute(
            `INSERT ALL
                INTO account_api_it_accounts (account_id, holder_name, status_code, opened_on, balance)
                    VALUES ('acc-1', 'Amina', 'A', DATE '2025-06-01', 1250.5)
                INTO account_api_it_accounts (account_id, holder_name, status_code, opened_on, balance)
                    VALUES ('acc-2', 'Omar', 'S', DATE '2025-07-15', 0)
             SELECT 1 FROM dual`,
        );
    });

    it('suspends through the procedure, reads its OUT bind and passes the actor', async () => {
        // Arrange
        const command = { accountId: 'acc-1', reason: 'fraud check' };

        // Act
        const result = await gateway.suspend(command, { actor: 'it-alice' });

        // Assert
        expect(result).toEqual({ ok: true, value: { status: 'SUSPENDED' } });
        const suspended = await queries.listByStatus('suspended');
        expect(suspended.map((a) => a.id)).toEqual(['acc-1', 'acc-2']);
        const audit = await db.withConnection('main', (conn: Connection) =>
            conn.execute(
                `SELECT suspended_by FROM account_api_it_accounts WHERE account_id = 'acc-1'`,
            ),
        );
        expect(audit.rows).toEqual([['it-alice']]);
    });

    it.each([
        ['missing', NotFoundError],
        ['acc-2', ConflictError],
    ])('maps the procedure refusal for %s to a failed Result', async (accountId, errorType) => {
        // Arrange
        const command = { accountId, reason: 'fraud check' };

        // Act
        const result = await gateway.suspend(command);

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(errorType);
    });

    it('reads rows from a procedure OUT SYS_REFCURSOR and maps their codes', async () => {
        // Arrange
        const status = 'active';

        // Act
        const accounts = await queries.listByStatus(status, { actor: 'it-alice' });

        // Assert
        expect(accounts).toEqual([
            {
                id: 'acc-1',
                holder: 'Amina',
                status: 'active',
                openedAt: expect.any(String) as string,
            },
        ]);
    });

    it.each([
        ['acc-1', 1250.5],
        ['missing', undefined],
    ])('reads the scalar function result for %s', async (accountId, expected) => {
        // Arrange: seeded accounts

        // Act
        const balance = await queries.getBalance(accountId);

        // Assert
        expect(balance).toBe(expected);
    });
});
