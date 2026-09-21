import { legacySchema } from '@infrastructure/config/schemas';

describe('legacySchema', () => {
    it('defaults to disabled with no prefixes', () => {
        // Arrange
        const input = {};

        // Act
        const parsed = legacySchema.parse(input);

        // Assert
        expect(parsed).toMatchObject({
            forwardEnabled: false,
            forwardPrefixes: [],
            preserveHostHeader: false,
            logRequests: true,
            logFileName: 'legacy-forward.log',
        });
        expect(parsed.targetUrl).toBeUndefined();
    });

    it('keeps the forwarding log in a file of its own, separate from the application log', () => {
        // Arrange
        const input = { logFileName: 'strangler.log' };

        // Act
        const parsed = legacySchema.parse(input);

        // Assert
        expect(parsed.logFileName).toBe('strangler.log');
    });

    it('rejects a log file name that would escape LOGGING_DIR', () => {
        // Arrange
        const input = { logFileName: '../../etc/legacy.log' };

        // Act
        const result = legacySchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
        const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
        expect(messages).toEqual(
            expect.arrayContaining([expect.stringContaining('LEGACY_LOG_FILE_NAME')]),
        );
    });

    it('accepts request logging turned off', () => {
        // Arrange
        const input = { logRequests: false };

        // Act
        const parsed = legacySchema.parse(input);

        // Assert
        expect(parsed.logRequests).toBe(false);
    });

    it('rejects enabled without a target URL or prefixes, naming the missing variables', () => {
        // Arrange
        const input = { forwardEnabled: true };

        // Act
        const result = legacySchema.safeParse(input);

        // Assert
        expect(result.success).toBe(false);
        const messages = result.success ? [] : result.error.issues.map((issue) => issue.message);
        expect(messages).toEqual(
            expect.arrayContaining([
                expect.stringContaining('LEGACY_TARGET_URL'),
                expect.stringContaining('LEGACY_FORWARD_PREFIXES'),
            ]),
        );
    });

    it('accepts enabled with a target URL and at least one prefix', () => {
        // Arrange
        const input = {
            forwardEnabled: true,
            targetUrl: 'http://legacy-host:8080',
            forwardPrefixes: ['/v1/orders'],
        };

        // Act
        const result = legacySchema.safeParse(input);

        // Assert
        expect(result.success).toBe(true);
    });
});
