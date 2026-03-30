// ============================================================
// Rate Limiter — Comprehensive tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRateLimiter } from '../../src/middleware/rate-limiter.js';
import type { Request, Response, NextFunction } from 'express';

function mockReq(ip = '127.0.0.1', path = '/api/test'): Request {
  return {
    ip,
    path,
    socket: { remoteAddress: ip },
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: any; _headers: Record<string, string> } {
  const res = {
    _status: 200,
    _json: null,
    _headers: {} as Record<string, string>,
    status(code: number) { res._status = code; return res; },
    json(body: any) { res._json = body; return res; },
    set(key: string, value: string) { res._headers[key] = value; return res; },
  };
  return res as unknown as Response & { _status: number; _json: any; _headers: Record<string, string> };
}

describe('RateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    const limiter = createRateLimiter({ maxRequests: 10, windowMs: 1000 });
    const next = vi.fn();

    for (let i = 0; i < 10; i++) {
      const res = mockRes();
      limiter(mockReq(), res, next);
    }

    expect(next).toHaveBeenCalledTimes(10);
  });

  it('rejects requests over the limit with 429', () => {
    const limiter = createRateLimiter({ maxRequests: 2, windowMs: 1000, burstSize: 2 });

    for (let i = 0; i < 2; i++) {
      const next = vi.fn();
      limiter(mockReq(), mockRes(), next);
    }

    const res = mockRes();
    const next = vi.fn();
    limiter(mockReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(429);
    expect(res._json.error).toBe('Too Many Requests');
  });

  it('refills tokens over time', () => {
    const limiter = createRateLimiter({ maxRequests: 5, windowMs: 1000, burstSize: 5 });
    const next = vi.fn();

    // Use all tokens
    for (let i = 0; i < 5; i++) {
      limiter(mockReq(), mockRes(), next);
    }
    expect(next).toHaveBeenCalledTimes(5);

    // Wait for refill
    vi.advanceTimersByTime(1000);

    const nextAfter = vi.fn();
    limiter(mockReq(), mockRes(), nextAfter);
    expect(nextAfter).toHaveBeenCalled();
  });

  it('tracks different IPs separately', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1000, burstSize: 1 });

    const next1 = vi.fn();
    limiter(mockReq('1.1.1.1'), mockRes(), next1);
    expect(next1).toHaveBeenCalled();

    const next2 = vi.fn();
    limiter(mockReq('2.2.2.2'), mockRes(), next2);
    expect(next2).toHaveBeenCalled();
  });

  it('bypasses health check routes', () => {
    const limiter = createRateLimiter({ maxRequests: 0, windowMs: 1000, burstSize: 0 });
    const next = vi.fn();
    limiter(mockReq('1.1.1.1', '/health'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('sets Retry-After header on 429', () => {
    const limiter = createRateLimiter({ maxRequests: 1, windowMs: 1000, burstSize: 1 });
    const next = vi.fn();
    limiter(mockReq(), mockRes(), next);

    const res = mockRes();
    limiter(mockReq(), res, vi.fn());
    expect(res._status).toBe(429);
    expect(res._headers['Retry-After']).toBeDefined();
  });
});
