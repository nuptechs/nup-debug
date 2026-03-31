import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import { requestLogger } from '../../src/middleware/request-logger.js';
import { logger } from '../../src/logger.js';

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/api/test',
    ip: '127.0.0.1',
    headers: { 'user-agent': 'test-agent' },
    requestId: undefined as string | undefined,
    startTime: undefined as number | undefined,
    ...overrides,
  } as any;
}

function mockRes() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const res: any = {
    statusCode: 200,
    setHeader: vi.fn(),
    on(event: string, fn: (...args: any[]) => void) {
      (listeners[event] ??= []).push(fn);
      return res;
    },
    /** Helper: fire an event (for tests) */
    _emit(event: string) {
      for (const fn of listeners[event] ?? []) fn();
    },
  };
  return res;
}

function mockNext() {
  return vi.fn();
}

describe('requestLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Request ID handling ----

  describe('request ID', () => {
    it('uses x-request-id header if valid', () => {
      const req = mockReq({ headers: { 'x-request-id': 'abc-123', 'user-agent': 'ua' } });
      const res = mockRes();

      requestLogger(req, res, mockNext());

      expect(req.requestId).toBe('abc-123');
      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'abc-123');
    });

    it('generates UUID if no x-request-id header', () => {
      const req = mockReq();
      const res = mockRes();

      requestLogger(req, res, mockNext());

      expect(req.requestId).toBeDefined();
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('rejects x-request-id longer than 128 chars', () => {
      const longId = 'a'.repeat(129);
      const req = mockReq({ headers: { 'x-request-id': longId, 'user-agent': 'ua' } });
      const res = mockRes();

      requestLogger(req, res, mockNext());

      expect(req.requestId).not.toBe(longId);
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('rejects x-request-id with invalid chars', () => {
      const req = mockReq({
        headers: { 'x-request-id': 'id with spaces!@#', 'user-agent': 'ua' },
      });
      const res = mockRes();

      requestLogger(req, res, mockNext());

      expect(req.requestId).not.toBe('id with spaces!@#');
      expect(req.requestId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('sets x-request-id response header', () => {
      const req = mockReq();
      const res = mockRes();

      requestLogger(req, res, mockNext());

      expect(res.setHeader).toHaveBeenCalledWith('x-request-id', req.requestId);
    });
  });

  // ---- Health check skip ----

  describe('health endpoint skipping', () => {
    it('skips /health path', () => {
      const req = mockReq({ path: '/health' });
      const res = mockRes();
      const next = mockNext();

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.requestId).toBeUndefined();
    });

    it('skips /ready path', () => {
      const req = mockReq({ path: '/ready' });
      const res = mockRes();
      const next = mockNext();

      requestLogger(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.requestId).toBeUndefined();
    });
  });

  // ---- Response finish logging ----

  describe('response finish logging', () => {
    it('logs info for 2xx status', () => {
      const req = mockReq();
      const res = mockRes();
      res.statusCode = 200;

      requestLogger(req, res, mockNext());
      res._emit('finish');

      expect(logger.info).toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs warn for 4xx status', () => {
      const req = mockReq();
      const res = mockRes();

      requestLogger(req, res, mockNext());
      res.statusCode = 404;
      res._emit('finish');

      expect(logger.warn).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('logs error for 5xx status', () => {
      const req = mockReq();
      const res = mockRes();

      requestLogger(req, res, mockNext());
      res.statusCode = 503;
      res._emit('finish');

      expect(logger.error).toHaveBeenCalled();
    });

    it('log includes requestId, method, path, status, duration, ip, userAgent', () => {
      const req = mockReq({
        method: 'POST',
        path: '/api/data',
        ip: '10.0.0.1',
        headers: { 'user-agent': 'my-client/1.0' },
      });
      const res = mockRes();
      res.statusCode = 201;

      requestLogger(req, res, mockNext());
      res._emit('finish');

      const logCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]!;
      const logData = logCall[0] as Record<string, unknown>;

      expect(logData.requestId).toBeDefined();
      expect(logData.method).toBe('POST');
      expect(logData.path).toBe('/api/data');
      expect(logData.status).toBe(201);
      expect(typeof logData.duration).toBe('number');
      expect(logData.ip).toBe('10.0.0.1');
      expect(logData.userAgent).toBe('my-client/1.0');
    });
  });

  // ---- Calls next ----

  describe('next()', () => {
    it('always calls next for non-health paths', () => {
      const next = mockNext();
      requestLogger(mockReq(), mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });
  });
});
