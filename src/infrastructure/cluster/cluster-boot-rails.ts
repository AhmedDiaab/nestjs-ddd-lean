import type { LoggerPort } from '@application/ports';

/**
 * Config slice `runClusterBootRails` reads — narrower than `AppConfig` on purpose, so a test
 * builds a small fixture instead of a full, valid config for every section. `AppConfig` satisfies
 * this structurally, so `startPrimary` passes it straight through.
 */
export type ClusterBootRailsConfig = {
    database?: { sources: ReadonlyArray<{ key: string; poolMax: number }> };
};

/**
 * Runs once in the primary, before any worker is forked. A worker-per-CPU process model turns a
 * silent capacity assumption into something visible before traffic finds it: for every
 * configured database source, log what `poolMax x workers` sessions it could open, so an
 * operator can check the total against what the DBA allows.
 *
 * Full's version of this rail also fails boot when `IDEMPOTENCY_STORE=memory` is combined with
 * more than one worker, and warns when `THROTTLE_STORAGE=memory` is — lean has neither an
 * idempotency store nor throttling, so neither check applies here (see decision 0012).
 */
export function runClusterBootRails(
    config: ClusterBootRailsConfig,
    workerCount: number,
    logger: LoggerPort,
): void {
    for (const source of config.database?.sources ?? []) {
        logger.info('cluster.pool.capacity', {
            source: source.key,
            poolMax: source.poolMax,
            workers: workerCount,
            totalSessions: source.poolMax * workerCount,
        });
    }
}
