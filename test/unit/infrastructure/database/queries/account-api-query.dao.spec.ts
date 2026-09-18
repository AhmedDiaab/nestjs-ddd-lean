import type { ConnectionProvider } from '@infrastructure/database/contracts';
import { AccountApiQueryDao } from '@infrastructure/database/queries';
import oracledb from 'oracledb';

const row = (id: string) => ({
    ACCOUNT_ID: id,
    HOLDER_NAME: `Holder ${id}`,
    STATUS_CODE: 'S',
    OPENED_ON: new Date('2025-06-01T00:00:00Z'),
});

describe('AccountApiQueryDao', () => {
    const connection = { execute: jest.fn() };
    const db = {
        withConnection: jest.fn((_key: string, fn: (c: unknown) => Promise<unknown>) =>
            fn(connection),
        ),
    };
    const sut = new AccountApiQueryDao(db as unknown as ConnectionProvider);

    afterEach(() => jest.clearAllMocks());

    const cursorWith = (batches: unknown[][]) => ({
        getRows: jest.fn(() => Promise.resolve(batches.shift() ?? [])),
        close: jest.fn(() => Promise.resolve()),
    });

    it('reads every batch from the OUT cursor, maps the rows and closes the cursor', async () => {
        // Arrange
        const full = Array.from({ length: 100 }, (_, i) => row(`a-${i}`));
        const cursor = cursorWith([full, [row('last')]]);
        connection.execute.mockResolvedValueOnce({ outBinds: { accounts: cursor } });

        // Act
        const accounts = await sut.listByStatus('suspended', { actor: 'alice' });

        // Assert
        expect(accounts).toHaveLength(101);
        expect(accounts[100]).toEqual({
            id: 'last',
            holder: 'Holder last',
            status: 'suspended',
            openedAt: '2025-06-01T00:00:00.000Z',
        });
        const [, binds, options] = connection.execute.mock.calls[0] as [string, object, object];
        expect(binds).toEqual({
            statusCode: 'S',
            accounts: { dir: oracledb.BIND_OUT, type: oracledb.CURSOR },
        });
        expect(options).toEqual({ outFormat: oracledb.OUT_FORMAT_OBJECT });
        expect(cursor.close).toHaveBeenCalledTimes(1);
    });

    it('closes the cursor even when reading fails', async () => {
        // Arrange
        const cursor = cursorWith([]);
        cursor.getRows.mockRejectedValueOnce(new Error('ORA-01002: fetch out of sequence'));
        connection.execute.mockResolvedValueOnce({ outBinds: { accounts: cursor } });

        // Act
        const call = sut.listByStatus('active');

        // Assert
        await expect(call).rejects.toThrow('ORA-01002');
        expect(cursor.close).toHaveBeenCalledTimes(1);
    });

    it.each([
        [1250.5, 1250.5],
        [null, undefined],
    ])('returns the function result %j as %j', async (returned, expected) => {
        // Arrange
        connection.execute.mockResolvedValueOnce({ outBinds: { balance: returned } });

        // Act
        const balance = await sut.getBalance('acc-1');

        // Assert
        expect(balance).toBe(expected);
        const [sql] = connection.execute.mock.calls[0] as [string];
        expect(sql).toContain(':balance := account_api.get_balance(');
    });
});
