import { lobToString } from '@infrastructure/database/utils';
import type { Maybe } from '@shared';
import type { Lob } from 'oracledb';

function fakeLob(chunks: string[]): { lob: Lob; setEncoding: jest.Mock } {
    const setEncoding = jest.fn();
    const lob = {
        setEncoding,
        [Symbol.asyncIterator]: () => {
            let index = 0;
            return {
                next: () => {
                    if (index < chunks.length) {
                        return Promise.resolve({ value: chunks[index++], done: false });
                    }
                    return Promise.resolve({ value: undefined, done: true });
                },
            };
        },
    } as unknown as Lob;

    return { lob, setEncoding };
}

function failingLob(error: Error): Lob {
    return {
        setEncoding: jest.fn(),
        [Symbol.asyncIterator]: () => ({
            next: () => Promise.reject(error),
        }),
    } as unknown as Lob;
}

describe('lobToString', () => {
    it('returns null for a null lob', async () => {
        // Arrange
        const lob = null as unknown as Maybe<Lob>;

        // Act
        const result = await lobToString(lob);

        // Assert
        expect(result).toBeNull();
    });

    it('returns null for an undefined lob', async () => {
        // Arrange
        const lob = undefined;

        // Act
        const result = await lobToString(lob);

        // Assert
        expect(result).toBeNull();
    });

    it('concatenates chunks read in utf8 encoding', async () => {
        // Arrange
        const { lob, setEncoding } = fakeLob(['hello ', 'world']);

        // Act
        const result = await lobToString(lob);

        // Assert
        expect(result).toBe('hello world');
        expect(setEncoding).toHaveBeenCalledWith('utf8');
    });

    it('returns an empty string, not null, for an empty CLOB', async () => {
        // Arrange
        const { lob } = fakeLob([]);

        // Act
        const result = await lobToString(lob);

        // Assert
        expect(result).toBe('');
    });

    it('propagates a stream error', async () => {
        // Arrange
        const lob = failingLob(new Error('read failed'));

        // Act
        const result = lobToString(lob);

        // Assert
        await expect(result).rejects.toThrow('read failed');
    });
});
