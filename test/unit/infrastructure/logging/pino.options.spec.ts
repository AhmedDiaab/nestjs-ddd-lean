import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { ConfigPort } from '@application/ports';
import {
    createDedicatedFileTargets,
    generatePinoOptions,
    isHealthCheck,
} from '@infrastructure/logging/pino.options';
import type { Options as PinoHttpOptions } from 'pino-http';

describe('pino options', () => {
    it.each([
        ['/health', true],
        ['/health/', true],
        ['/health/ready', true],
        ['/health/ready?probe=1', true],
        ['/v1/health', false],
        ['/healthz', false],
        ['/health/other', false],
        [undefined, false],
    ])('isHealthCheck(%j) returns %j', (url, expected) => {
        // Arrange: url from table

        // Act
        const result = isHealthCheck(url);

        // Assert
        expect(result).toBe(expected);
    });

    describe('createDedicatedFileTargets', () => {
        const configWith = (values: Record<string, unknown>): ConfigPort =>
            ({
                get: (key: string) => values[key],
                isDevelopment: () => false,
                isProduction: () => true,
                all: () => values,
            }) as unknown as ConfigPort;

        it('writes to its own rotated file, not the application log', () => {
            // Arrange
            const config = configWith({
                'logging.toFile': true,
                'logging.directory': 'logs',
                'logging.fileName': 'app.log',
                'logging.filesLimit': 14,
                'logging.maxSize': '10m',
                'logging.logLevel': 'info',
            });

            // Act
            const targets = createDedicatedFileTargets(config, 'legacy-forward.log');

            // Assert
            expect(targets).toHaveLength(1);
            expect(targets[0]?.target).toBe('pino-roll');
            expect(targets[0]?.options).toMatchObject({
                file: join('logs', 'legacy-forward.log'),
                limit: { count: 15 },
            });
        });

        it('falls back to the console when file logging is off, instead of dropping the lines', () => {
            // Arrange
            const config = configWith({ 'logging.toFile': false, 'logging.logLevel': 'info' });

            // Act
            const targets = createDedicatedFileTargets(config, 'legacy-forward.log');

            // Assert
            expect(targets).toHaveLength(1);
            expect(targets[0]?.target).not.toBe('pino-roll');
        });
    });

    describe('customLogLevel', () => {
        const config = {
            get: () => undefined,
            isDevelopment: () => false,
            isProduction: () => true,
            all: () => ({}),
        } as unknown as ConfigPort;
        const options = generatePinoOptions(config).pinoHttp as PinoHttpOptions;
        const level = (url: string, statusCode: number) =>
            options.customLogLevel!(
                { url } as IncomingMessage,
                { statusCode } as ServerResponse,
                undefined,
            );

        it.each([
            ['silences successful health polls', '/health', 200, 'silent'],
            ['still logs failing health checks', '/health/ready', 503, 'error'],
            ['logs normal requests', '/v1/orders', 200, 'info'],
        ])('%s', (_case, url, statusCode, expected) => {
            // Arrange: request from table

            // Act
            const result = level(url, statusCode);

            // Assert
            expect(result).toBe(expected);
        });
    });
});
