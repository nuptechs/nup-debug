import { describe, it, expect, vi } from 'vitest';
import { asyncHandler } from '../../src/middleware/async-handler.js';

function mockReq(overrides: Record<string, unknown> = {}) {
  return { method: 'GET', path: '/', ...overrides } as any;
}

function mockRes() {
  const res: any = {
    statusCode: 200,
    headersSent: false,
    status(code: number) { res.statusCode = code; return res; },
    json(body: unknown) { res._body = body; return res; },
    setHeader: vi.fn(),
  };
  return res;
}

function mockNext() {
  return vi.fn();
}

describe('asyncHandler', () => {
  it('calls the handler and does not call next with error on success', async () => {
    const handler = vi.fn(async (_req, res, _next) => {
      res.status(200).json({ ok: true });
    });

    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    const wrapped = asyncHandler(handler);
    await wrapped(req, res, next);

    // Give the Promise.resolve chain time to settle
    await Promise.resolve();

    expect(handler).toHaveBeenCalledOnce();
    expect(next).not.toHaveBeenCalled();
    expect(res._body).toEqual({ ok: true });
  });

  it('calls next with the error when handler throws', async () => {
    const error = new Error('boom');
    const handler = vi.fn(async () => {
      throw error;
    });

    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    const wrapped = asyncHandler(handler);
    await wrapped(req, res, next);

    // Allow catch chain to run
    await Promise.resolve();
    await Promise.resolve();

    expect(next).toHaveBeenCalledWith(error);
  });

  it('works with synchronous return (Promise.resolve wraps it)', async () => {
    const handler = vi.fn(async (_req, res) => {
      res.status(204);
    });

    const req = mockReq();
    const res = mockRes();
    const next = mockNext();

    const wrapped = asyncHandler(handler);
    await wrapped(req, res, next);
    await Promise.resolve();

    expect(handler).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(204);
    expect(next).not.toHaveBeenCalled();
  });
});
