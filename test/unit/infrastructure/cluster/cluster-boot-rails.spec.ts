import type { LoggerPort } from '@application/ports';
import { runClusterBootRails, type ClusterBootRailsConfig } from '@infrastructure/cluster';

describe('runClusterBootRails', () => {
    const debug = jest.fn();
    const info = jest.fn();
    const warn = jest.fn();
    const error = jest.fn();
    const logger: LoggerPort = { debug, info, warn, error };

    afterEach(() => jest.clearAllMocks());

    it('logs the pool capacity arithmetic per configured database source', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {
            database: {
                sources: [
                    { key: 'main', poolMax: 10 },
                    { key: 'reports', poolMax: 5 },
                ],
            },
        };

        // Act
        runClusterBootRails(config, 3, logger);

        // Assert
        expect(info).toHaveBeenCalledWith('cluster.pool.capacity', {
            source: 'main',
            poolMax: 10,
            workers: 3,
            totalSessions: 30,
        });
        expect(info).toHaveBeenCalledWith('cluster.pool.capacity', {
            source: 'reports',
            poolMax: 5,
            workers: 3,
            totalSessions: 15,
        });
    });

    it('logs nothing about pools when no database is configured', () => {
        // Arrange
        const config: ClusterBootRailsConfig = {};

        // Act
        runClusterBootRails(config, 3, logger);

        // Assert
        expect(info).not.toHaveBeenCalled();
        expect(warn).not.toHaveBeenCalled();
    });
});
