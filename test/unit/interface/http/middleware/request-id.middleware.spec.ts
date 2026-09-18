import type { ConfigPort } from '@application/ports';
import { RequestIdMiddleware } from '@interface/http/middleware';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

const configWith = (values: Record<string, unknown>) =>
    ({ get: (key: string) => values[key] }) as unknown as ConfigPort;

const config = configWith({ 'logging.requestIdHeader': 'x-request-id' });

function requestWith(headerValue?: string): Request {
    return {
        id: undefined,
        headers: headerValue === undefined ? {} : { 'x-request-id': headerValue },
    } as unknown as Request;
}

function fakeResponse(): Response & { setHeader: jest.Mock } {
    return { setHeader: jest.fn() } as unknown as Response & { setHeader: jest.Mock };
}

describe('RequestIdMiddleware', () => {
    it('reuses a safe inbound id as-is', () => {
        // Arrange
        const sut = new RequestIdMiddleware(config);
        const req = requestWith('caller-supplied-id');
        const res = fakeResponse();
        const next: NextFunction = jest.fn();

        // Act
        sut.use(req, res, next);

        // Assert
        expect(req.id).toBe('caller-supplied-id');
        expect(req.headers['x-request-id']).toBe('caller-supplied-id');
    });

    it('replaces a hostile inbound id with a safe generated one', () => {
        // Arrange
        const sut = new RequestIdMiddleware(config);
        const req = requestWith('x'.repeat(500));
        const res = fakeResponse();
        const next: NextFunction = jest.fn();

        // Act
        sut.use(req, res, next);

        // Assert
        expect(req.id).toMatch(SAFE_ID_PATTERN);
        expect(req.id).not.toBe('x'.repeat(500));
    });

    it('always sets the response header to the resolved id', () => {
        // Arrange
        const sut = new RequestIdMiddleware(config);
        const req = requestWith('caller-supplied-id');
        const res = fakeResponse();
        const next: NextFunction = jest.fn();

        // Act
        sut.use(req, res, next);

        // Assert
        expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'caller-supplied-id');
    });

    it('calls next', () => {
        // Arrange
        const sut = new RequestIdMiddleware(config);
        const req = requestWith();
        const res = fakeResponse();
        const next: NextFunction = jest.fn();

        // Act
        sut.use(req, res, next);

        // Assert
        expect(next).toHaveBeenCalledTimes(1);
    });
});
