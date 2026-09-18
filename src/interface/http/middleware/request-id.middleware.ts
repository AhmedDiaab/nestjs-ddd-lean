import { randomUUID } from 'node:crypto';
import { ConfigPortToken, type ConfigPort } from '@application/ports';
import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import { isSafeCorrelationId } from '@shared';
import type { NextFunction, Request, Response } from 'express';

/**
 * Gives every request a correlation id a support ticket can quote back to us: reuses a safe
 * inbound id (`req.id` or the configured header), otherwise mints one, and echoes it on the
 * response so the caller can log it too.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
    constructor(@Inject(ConfigPortToken) private readonly config: ConfigPort) {}

    use(req: Request, res: Response, next: NextFunction): void {
        const headerName = this.config.get('logging.requestIdHeader');
        const requestId = this.requestIdFor(req, headerName);

        // the request id in the body's meta is the one the caller can quote back to us
        req.headers[headerName] = requestId;
        req.id = requestId;

        res.setHeader(headerName, requestId);

        next();
    }

    /**
     * A caller may supply the correlation id, but not arbitrary bytes: an unbounded header
     * would end up in every log line for that request, newlines and all.
     */
    private requestIdFor(req: Request, headerName: string): string {
        const header = req.headers[headerName];
        const candidate = Array.isArray(header) ? header[0] : header;

        if (typeof req.id === 'string' && isSafeCorrelationId(req.id)) return req.id;
        if (isSafeCorrelationId(candidate)) return candidate;

        return randomUUID();
    }
}
