import { ConflictError, NotFoundError } from '@application/errors';
import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { DatabaseExecutionError } from '@infrastructure/database/errors';
import { AccountApiGateway } from '@infrastructure/database/gateways';
import oracledb from 'oracledb';

describe('AccountApiGateway.suspend', () => {
    const connection = { execute: jest.fn() };
    const db = {
        transaction: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };
    const sut = new AccountApiGateway(db as unknown as ConnectionProvider);
    const command = { accountId: 'acc-1', reason: 'fraud check' };

    afterEach(() => jest.clearAllMocks());

    it('calls the procedure with named binds and returns its OUT status', async () => {
        // Arrange
        connection.execute.mockResolvedValueOnce({ outBinds: { status: 'SUSPENDED' } });

        // Act
        const result = await sut.suspend(command, { actor: 'alice' });

        // Assert
        expect(result).toEqual({ ok: true, value: { status: 'SUSPENDED' } });
        const [sql, binds] = connection.execute.mock.calls[0] as [string, Record<string, unknown>];
        expect(sql).toContain('account_api.suspend_account(');
        expect(sql).toContain('p_account_id => :accountId');
        expect(binds).toEqual({
            accountId: 'acc-1',
            reason: 'fraud check',
            status: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 20 },
        });
        expect(db.transaction).toHaveBeenCalledWith('main', expect.any(Function), {
            contextUser: 'alice',
            tag: 'accounts.suspend',
        });
    });

    it.each([
        ['ORA-20001', NotFoundError],
        ['ORA-20002', ConflictError],
    ])('maps the procedure error %s to a failed Result', async (code, errorType) => {
        // Arrange
        db.transaction.mockRejectedValueOnce(
            new DatabaseExecutionError('main', 'accounts.suspend', new Error(code), code),
        );

        // Act
        const result = await sut.suspend(command);

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(errorType);
    });

    it('rethrows errors that are not part of the procedure contract', async () => {
        // Arrange
        const unexpected = new DatabaseExecutionError(
            'main',
            'accounts.suspend',
            undefined,
            'ORA-06550',
        );
        db.transaction.mockRejectedValueOnce(unexpected);

        // Act
        const call = sut.suspend(command);

        // Assert
        await expect(call).rejects.toBe(unexpected);
    });
});
