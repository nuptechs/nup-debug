import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { errorHandler, notFoundHandler } from '../../src/middleware/error-handler.js';
import { logger } from '../../src/logger.js';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/test',
    requestId: 'req-123',
    ...overrides,
  } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    _body: null as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res._body = body; return res; },
  };
  return res;
}

function mockNext() {
  return vi.fn();
}

describe('errorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('responds with statusCode and message for client errors (<500)', () => {
    const err: any = new Error('Not found');
    err.statusCode = 404;

    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, mockNext());

    expect(res.statusCode).toBe(404);
    expect(res._body).toEqual({ error: 'Not found' });
    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('responds with generic message for 500 errors', () => {
    const err: any = new Error('DB connection failed');
    err.statusCode = 500;

    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, mockNext());

    expect(res.statusCode).toBe(500);
    expect(res._body).toEqual({ error: 'Internal server error' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('defaults to 500 when error has no statusCode', () => {
    const err = new Error('unexpected');

    const req = mockReq();
    const res = mockRes();

    errorHandler(err as any, req, res, mockNext());

    expect(res.statusCode).toBe(500);
    expect(res._body).toEqual({ error: 'Internal server error' });
    expect(logger.error).toHaveBeenCalled();
  });

  it('does NOT call res.status/json when headersSent is true', () => {
    const err: any = new Error('too late');
    err.statusCode = 400;

    const req = mockReq();
    const res = mockRes();
    res.headersSent = true;
    const statusSpy = vi.spyOn(res, 'status');
    const jsonSpy = vi.spyOn(res, 'json');

    errorHandler(err, req, res, mockNext());

    expect(statusSpy).not.toHaveBeenCalled();
    expect(jsonSpy).not.toHaveBeenCalled();
  });

  it('logs with warn for 4xx errors', () => {
    const err: any = new Error('Bad input');
    err.statusCode = 422;

    errorHandler(err, mockReq(), mockRes(), mockNext());

    expect(logger.warn).toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('includes requestId, path, method, code in log data', () => {
    const err: any = new Error('fail');
    err.statusCode = 503;
    err.code = 'SERVICE_UNAVAILABLE';

    const req = mockReq({ requestId: 'rid-abc', path: '/api/foo', method: 'POST' });

    errorHandler(err, req, mockRes(), mockNext());

    const logCall = (logger.error as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(logCall[0]).toMatchObject({
      requestId: 'rid-abc',
      path: '/api/foo',
      method: 'POST',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
    });
  });
});

describe('notFoundHandler', () => {
  it('returns 404 with {error: "Not found"}', () => {
    const req = mockReq();
    const res = mockRes();

    notFoundHandler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res._body).toEqual({ error: 'Not found' });
  });
});
