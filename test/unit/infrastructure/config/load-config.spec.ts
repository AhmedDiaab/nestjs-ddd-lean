import { InvalidConfigError, loadConfig } from '@infrastructure/config';
import { config as dotenvFlow } from 'dotenv-flow';

jest.mock('dotenv-flow', () => ({ config: jest.fn() }));

const readEnvFiles = dotenvFlow as jest.MockedFunction<typeof dotenvFlow>;

const BASE_ENV = {
    NODE_ENV: 'test',
    JWT_SECRET: 'x'.repeat(32),
};

describe('loadConfig', () => {
    const original = process.env;

    beforeEach(() => {
        process.env = { ...BASE_ENV };
        readEnvFiles.mockClear();
    });

    afterAll(() => {
        process.env = original;
    });

    // `main.ts` calls loadConfig() before Nest exists, to build httpsOptions. Reading the env
    // file has to happen here rather than in EnvConfigAdapter, or that earlier caller parses a
    // bare environment and a deployment whose secrets live in .env.<NODE_ENV> dies at boot.
    it('reads the env file before validating, outside test environments', () => {
        // Arrange
        process.env = { ...BASE_ENV, NODE_ENV: 'production' };

        // Act
        loadConfig();

        // Assert
        expect(readEnvFiles).toHaveBeenCalledTimes(1);
    });

    // Two pino-roll transports on one file would interleave their lines and race each other's
    // rotation — the opposite of what a separate forwarding log is for.
    it('refuses a legacy forwarding log pointed at the application log file', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            LOGGING_FILE_NAME: 'app.log',
            LEGACY_LOG_FILE_NAME: 'app.log',
        };

        // Act
        const load = () => loadConfig();

        // Assert
        expect(load).toThrow(InvalidConfigError);
        expect(load).toThrow(/LEGACY_LOG_FILE_NAME/);
    });

    it('leaves the env file alone under test, where specs set process.env themselves', () => {
        // Arrange: BASE_ENV already sets NODE_ENV to test

        // Act
        loadConfig();

        // Assert
        expect(readEnvFiles).not.toHaveBeenCalled();
    });

    it('applies schema defaults when env values are unset', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.logging.toFile).toBe(true); // was false before: "=== 'true'" on undefined
        expect(config.logging.filesLimit).toBe(14); // was NaN before: parseInt('')
        expect(config.http.corsOrigins).toEqual([]);
        expect(config.database).toBeUndefined();
    });

    it('parses booleans, numbers and lists from env strings', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            LOGGING_TO_FILE: 'false',
            LOGGING_FILES_LIMIT: '7',
            CORS_ORIGINS: 'https://a.example, https://b.example',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.logging.toFile).toBe(false);
        expect(config.logging.filesLimit).toBe(7);
        expect(config.http.corsOrigins).toEqual(['https://a.example', 'https://b.example']);
    });

    it('loads scheduler config from env, defaulting to disabled', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.scheduler).toMatchObject({ enabled: false, timezone: 'UTC' });
        expect(config.shutdown.jobDrainMs).toBe(10000);
    });

    it('parses scheduler and job-drain overrides from env', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            SCHEDULER_ENABLED: 'true',
            SCHEDULER_TIMEZONE: 'Africa/Cairo',
            SHUTDOWN_JOB_DRAIN_MS: '2000',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.scheduler).toMatchObject({ enabled: true, timezone: 'Africa/Cairo' });
        expect(config.shutdown.jobDrainMs).toBe(2000);
    });

    it('loads cluster config from env, defaulting to disabled', () => {
        // Arrange: only BASE_ENV is set

        // Act
        const config = loadConfig();

        // Assert
        expect(config.cluster).toMatchObject({
            enabled: false,
            workers: 0,
            respawn: true,
            isLeader: false,
        });
    });

    it('parses cluster overrides from env', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            CLUSTER_ENABLED: 'true',
            CLUSTER_WORKERS: '4',
            CLUSTER_RESPAWN: 'false',
            CLUSTER_RESPAWN_MAX_PER_MINUTE: '5',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.cluster).toMatchObject({
            enabled: true,
            workers: 4,
            respawn: false,
            respawnMaxPerMinute: 5,
        });
    });

    it('loads database config with health list and oracle driver options', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            DATABASE_CONFIG_JSON: JSON.stringify([
                { key: 'main', dialect: 'oracle', connectString: 'h/s', user: 'u', password: 'p' },
            ]),
            DATABASE_PING_REQUIRED_SOURCES: 'main',
            ORACLE_FETCH_AS_STRING: 'clob,number',
        };

        // Act
        const config = loadConfig();

        // Assert
        expect(config.database?.health).toMatchObject({
            pingOnBoot: true,
            requiredSources: ['main'],
        });
        expect(config.database?.oracle.fetchAsString).toEqual(['CLOB', 'NUMBER']);
    });

    it('never includes secret values in validation errors', () => {
        // Arrange
        process.env = {
            ...BASE_ENV,
            JWT_SECRET: 'short-secret-value',
            DATABASE_CONFIG_JSON:
                '{"sources": [{"key":"main","dialect":"oracle","password":"TopSecret!"',
        };

        // Act
        let error: unknown;
        try {
            loadConfig();
        } catch (e) {
            error = e;
        }

        // Assert
        expect(error).toBeInstanceOf(InvalidConfigError);
        const text = `${(error as Error).message} ${JSON.stringify((error as InvalidConfigError).issues)}`;
        expect(text).not.toContain('TopSecret');
        expect(text).not.toContain('short-secret-value');
    });
});
