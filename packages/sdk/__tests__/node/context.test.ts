// ============================================================
// Async Context Propagation — Comprehensive tests
// runWithContext, getCurrentContext, request/correlation IDs
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  probeStorage,
  runWithContext,
  getCurrentContext,
  getCurrentRequestId,
  getCurrentCorrelationId,
} from '../../src/node/context.js';
import type { ProbeContext } from '../../src/node/context.js';

// ── Helpers ───────────────────────────────────────────────────

function makeContext(overrides?: Partial<ProbeContext>): ProbeContext {
  return {
    correlationId: 'corr-123',
    requestId: 'req-456',
    sessionId: 'sess-789',
    ...overrides,
  };
}

// ── runWithContext ────────────────────────────────────────────

describe('runWithContext', () => {
  it('makes context available inside callback', () => {
    const ctx = makeContext();
    let captured: ProbeContext | undefined;

    runWithContext(ctx, () => {
      captured = getCurrentContext();
    });

    expect(captured).toEqual(ctx);
  });

  it('returns the callback return value', () => {
    const ctx = makeContext();
    const result = runWithContext(ctx, () => 42);
    expect(result).toBe(42);
  });
});

// ── getCurrentContext ────────────────────────────────────────

describe('getCurrentContext', () => {
  it('returns undefined outside of any context', () => {
    const ctx = getCurrentContext();
    expect(ctx).toBeUndefined();
  });

  it('returns the active context inside runWithContext', () => {
    const ctx = makeContext({ requestId: 'r1' });

    runWithContext(ctx, () => {
      expect(getCurrentContext()).toEqual(ctx);
    });
  });
});

// ── getCurrentRequestId ──────────────────────────────────────

describe('getCurrentRequestId', () => {
  it('returns correct requestId inside context', () => {
    const ctx = makeContext({ requestId: 'req-abc' });

    runWithContext(ctx, () => {
      expect(getCurrentRequestId()).toBe('req-abc');
    });
  });

  it('returns undefined outside context', () => {
    expect(getCurrentRequestId()).toBeUndefined();
  });
});

// ── getCurrentCorrelationId ──────────────────────────────────

describe('getCurrentCorrelationId', () => {
  it('returns correct correlationId inside context', () => {
    const ctx = makeContext({ correlationId: 'corr-xyz' });

    runWithContext(ctx, () => {
      expect(getCurrentCorrelationId()).toBe('corr-xyz');
    });
  });

  it('returns undefined outside context', () => {
    expect(getCurrentCorrelationId()).toBeUndefined();
  });
});

// ── Nested contexts ──────────────────────────────────────────

describe('nested contexts', () => {
  it('inner context shadows outer context', () => {
    const outer = makeContext({ requestId: 'outer-req', correlationId: 'outer-corr' });
    const inner = makeContext({ requestId: 'inner-req', correlationId: 'inner-corr' });

    runWithContext(outer, () => {
      expect(getCurrentRequestId()).toBe('outer-req');

      runWithContext(inner, () => {
        expect(getCurrentRequestId()).toBe('inner-req');
        expect(getCurrentCorrelationId()).toBe('inner-corr');
      });

      // Outer context restored after inner completes
      expect(getCurrentRequestId()).toBe('outer-req');
      expect(getCurrentCorrelationId()).toBe('outer-corr');
    });
  });
});

// ── Async propagation ────────────────────────────────────────

describe('async propagation', () => {
  it('context survives across async/await', async () => {
    const ctx = makeContext({ requestId: 'async-req' });

    await new Promise<void>((resolve) => {
      runWithContext(ctx, async () => {
        // Simulate async work
        await new Promise((r) => setTimeout(r, 10));

        expect(getCurrentRequestId()).toBe('async-req');
        expect(getCurrentCorrelationId()).toBe('corr-123');
        resolve();
      });
    });
  });

  it('context survives multiple chained awaits', async () => {
    const ctx = makeContext({ requestId: 'chain-req', correlationId: 'chain-corr' });

    await new Promise<void>((resolve) => {
      runWithContext(ctx, async () => {
        await Promise.resolve();
        expect(getCurrentRequestId()).toBe('chain-req');

        await new Promise((r) => setTimeout(r, 5));
        expect(getCurrentCorrelationId()).toBe('chain-corr');

        resolve();
      });
    });
  });

  it('parallel async contexts do not interfere', async () => {
    const ctx1 = makeContext({ requestId: 'req-1' });
    const ctx2 = makeContext({ requestId: 'req-2' });

    const results = await Promise.all([
      new Promise<string | undefined>((resolve) => {
        runWithContext(ctx1, async () => {
          await new Promise((r) => setTimeout(r, 20));
          resolve(getCurrentRequestId());
        });
      }),
      new Promise<string | undefined>((resolve) => {
        runWithContext(ctx2, async () => {
          await new Promise((r) => setTimeout(r, 10));
          resolve(getCurrentRequestId());
        });
      }),
    ]);

    expect(results).toEqual(['req-1', 'req-2']);
  });
});

// ── probeStorage direct usage ────────────────────────────────

describe('probeStorage', () => {
  it('is an AsyncLocalStorage instance', () => {
    expect(probeStorage).toBeDefined();
    expect(typeof probeStorage.run).toBe('function');
    expect(typeof probeStorage.getStore).toBe('function');
  });
});
