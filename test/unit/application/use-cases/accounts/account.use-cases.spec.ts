import { ConflictError, NotFoundError } from '@application/errors';
import type { AccountGateway, AccountQueryPort } from '@application/ports';
import { GetAccountBalanceUseCase, SuspendAccountUseCase } from '@application/use-cases';
import { Result } from '@shared';

describe('account use cases', () => {
    it('suspends through the gateway as the acting user', async () => {
        // Arrange
        const suspend = jest.fn(() => Promise.resolve(Result.ok({ status: 'SUSPENDED' })));
        const sut = new SuspendAccountUseCase({ suspend } as AccountGateway);

        // Act
        const result = await sut.execute({
            accountId: 'acc-1',
            reason: 'fraud',
            username: 'alice',
        });

        // Assert
        expect(result).toEqual({ ok: true, value: { accountId: 'acc-1', status: 'SUSPENDED' } });
        expect(suspend).toHaveBeenCalledWith(
            { accountId: 'acc-1', reason: 'fraud' },
            { actor: 'alice' },
        );
    });

    it('returns the gateway refusal unchanged', async () => {
        // Arrange
        const refusal = Result.err(new ConflictError('already suspended'));
        const sut = new SuspendAccountUseCase({ suspend: () => Promise.resolve(refusal) });

        // Act
        const result = await sut.execute({
            accountId: 'acc-1',
            reason: 'fraud',
            username: 'alice',
        });

        // Assert
        expect(result).toBe(refusal);
    });

    it('returns NotFoundError when the balance function knows no such account', async () => {
        // Arrange
        const queries = {
            getBalance: () => Promise.resolve(undefined),
        } as unknown as AccountQueryPort;
        const sut = new GetAccountBalanceUseCase(queries);

        // Act
        const result = await sut.execute({ accountId: 'missing', username: 'alice' });

        // Assert
        expect(!result.ok && result.error).toBeInstanceOf(NotFoundError);
    });
});
