import type { ConfigPort, LoggerPort } from '@application/ports';
import pino from 'pino';
import { createDedicatedFileTargets } from './pino.options';

/**
 * A `LoggerPort` backed by plain pino that writes to a rotated file of its OWN, separate from
 * `app.log` — same directory, level and rotation settings, different file name. For traffic that
 * deserves its own ledger instead of being interleaved with this service's requests: today, the
 * legacy forwarder (`src/infrastructure/legacy/legacy-forwarder.ts`), whose requests never reach
 * Nest's router and so never appear in the pino-http access log at all.
 *
 * Like `PinoProcessLogger` it is built directly in `src/main.ts` rather than injected: the
 * forwarder is wired with `app.use()` before Nest's middleware stack, outside request context.
 * With `LOGGING_TO_FILE=false` the lines go to the console instead — see
 * `createDedicatedFileTargets`.
 */
export class PinoFileLogger implements LoggerPort {
    private readonly logger: pino.Logger;

    constructor(config: ConfigPort, fileName: string) {
        this.logger = pino({
            level: config.get('logging.logLevel'),
            base: { pid: process.pid },
            transport: { targets: createDedicatedFileTargets(config, fileName) },
        });
    }

    debug(message: string, meta?: Record<string, unknown>): void {
        this.logger.debug(meta ?? {}, message);
    }

    info(message: string, meta: Record<string, unknown>): void {
        this.logger.info(meta, message);
    }

    warn(message: string, meta: Record<string, unknown>): void {
        this.logger.warn(meta, message);
    }

    error(message: string, meta: Record<string, unknown>): void {
        this.logger.error(meta, message);
    }
}
