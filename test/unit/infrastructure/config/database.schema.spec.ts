import { databaseConfigSchema } from '@infrastructure/config/schemas';

const oracle = { key: 'main', dialect: 'oracle', connectString: 'h/s', user: 'u', password: 'p' };

describe('databaseConfigSchema', () => {
    afterEach(() => {
        delete process.env.TEST_DB_PASSWORD;
    });

    it('parses JSON sources and applies oracle defaults', () => {
        // Arrange
        const input = { sources: JSON.stringify([oracle]), health: {} };

        // Act
        const parsed = databaseConfigSchema.parse(input);

        // Assert
        expect(parsed.sources[0]).toMatchObject({
            poolMin: 2,
            poolMax: 10,
            queueTimeoutMs: 60000,
            stmtCacheSize: 30,
            contextUser: { enabled: true, required: false, maxLength: 64 },
        });
        expect(parsed.health.pingOnBoot).toBe(true);
        expect(parsed.oracle.thickMode).toBe(false);
    });

    it('accepts the { sources: [...] } wrapper form', () => {
        // Arrange
        const input = { sources: JSON.stringify({ sources: [oracle] }), health: {} };

        // Act
        const parsed = databaseConfigSchema.parse(input);

        // Assert
        expect(parsed.sources).toHaveLength(1);
    });

    it('resolves passwordEnv from the environment', () => {
        // Arrange
        process.env.TEST_DB_PASSWORD = 'from-env';
        const { password: _omit, ...withoutPassword } = oracle;
        void _omit;
        const input = {
            sources: [{ ...withoutPassword, passwordEnv: 'TEST_DB_PASSWORD' }],
            health: {},
        };

        // Act
        const parsed = databaseConfigSchema.parse(input);

        // Assert
        expect(parsed.sources[0]).toMatchObject({ password: 'from-env' });
    });

    it.each([
        [
            'oracle sources without credentials',
            [{ key: 'main', dialect: 'oracle', connectString: 'h/s' }],
        ],
        ['poolMin greater than poolMax', [{ ...oracle, poolMin: 20, poolMax: 5 }]],
        ['duplicate source keys', [oracle, oracle]],
        ['a dialect outside the enum', [{ key: 'x', dialect: 'db2' }]],
    ])('rejects %s', (_case, sources) => {
        // Arrange
        const input = { sources, health: {} };

        // Act
        const result = databaseConfigSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
    });

    it('accepts a source for an unimplemented dialect and keeps its extra keys', () => {
        // Arrange
        const input = {
            sources: [
                {
                    key: 'pg',
                    dialect: 'postgres',
                    connectionUrl: 'postgres://u:p@h:5432/d',
                    sslMode: 'require',
                },
            ],
            health: {},
        };

        // Act
        const result = databaseConfigSchema.safeParse(input);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data?.sources[0]).toMatchObject({ dialect: 'postgres', sslMode: 'require' });
    });
});
