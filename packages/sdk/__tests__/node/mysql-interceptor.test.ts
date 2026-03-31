// ============================================================
// MySQL Interceptor — Comprehensive tests
// Wrap/unwrap, event emission, query normalization, extraction
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapMysqlPool,
  unwrapMysqlPool,
} from '../../src/node/mysql-interceptor.js';

// ── Mock MySQL pool factory ──────────────────────────────────

function createMockPool(queryResult: unknown = [[], []]) {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
    execute: vi.fn().mockResolvedValue(queryResult),
  };
}

function createConfig() {
  const events: any[] = [];
  return {
    emitEvent: vi.fn((e: any) => events.push(e)),
    sessionId: 'test-session',
    redactParams: true,
    _events: events,
  };
}

// ── Wrapping & unwrapping ────────────────────────────────────

describe('wrapMysqlPool', () => {
  it('wraps pool.query and pool.execute', () => {
    const pool = createMockPool();
    const originalQuery = pool.query;
    const originalExecute = pool.execute;
    const config = createConfig();

    wrapMysqlPool(pool, config);

    expect(pool.query).not.toBe(originalQuery);
    expect(pool.execute).not.toBe(originalExecute);

    unwrapMysqlPool(pool);
  });

  it('skips already-wrapped pools (idempotent)', () => {
    const pool = createMockPool();
    const config = createConfig();

    wrapMysqlPool(pool, config);
    const wrappedQuery = pool.query;

    wrapMysqlPool(pool, config);
    expect(pool.query).toBe(wrappedQuery);

    unwrapMysqlPool(pool);
  });
});

describe('unwrapMysqlPool', () => {
  it('restores original methods (no longer wrapped)', async () => {
    const pool = createMockPool();
    const config = createConfig();

    wrapMysqlPool(pool, config);
    // Wrapped: should emit events
    await pool.query('SELECT 1');
    expect(config.emitEvent).toHaveBeenCalledTimes(1);

    unwrapMysqlPool(pool);
    // After unwrap: should NOT emit additional events
    config.emitEvent.mockClear();
    await pool.query('SELECT 1');
    expect(config.emitEvent).not.toHaveBeenCalled();
  });

  it('is a no-op for non-wrapped pools', () => {
    const pool = createMockPool();
    const originalQuery = pool.query;

    unwrapMysqlPool(pool);
    expect(pool.query).toBe(originalQuery);
  });
});

// ── Promise-style event emission ─────────────────────────────

describe('wrapMysqlPool — promise-style', () => {
  let pool: ReturnType<typeof createMockPool>;
  let config: ReturnType<typeof createConfig>;

  beforeEach(() => {
    pool = createMockPool([[{ id: 1 }, { id: 2 }], [{ name: 'id' }]]);
    config = createConfig();
    wrapMysqlPool(pool, config);
  });

  afterEach(() => {
    unwrapMysqlPool(pool);
  });

  it('emits event on successful query with duration and rowCount', async () => {
    await pool.query('SELECT * FROM users');

    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    const event = config._events[0];
    expect(event.type).toBe('db-query');
    expect(event.query).toContain('SELECT');
    expect(event.rowCount).toBe(2);
    expect(event.duration).toBeGreaterThanOrEqual(0);
    expect(event.error).toBeUndefined();
  });

  it('emits event on successful execute', async () => {
    await pool.execute('INSERT INTO users (name) VALUES (?)', ['Alice']);

    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    const event = config._events[0];
    expect(event.type).toBe('db-query');
  });

  it('emits event on error with error message and re-throws', async () => {
    // Create a fresh pool that always rejects, then wrap it
    const errorPool: any = {
      query: vi.fn().mockRejectedValue(new Error('ER_BAD_FIELD')),
    };
    const errorConfig = createConfig();
    wrapMysqlPool(errorPool, errorConfig);

    await expect(errorPool.query('SELECT bad FROM users')).rejects.toThrow('ER_BAD_FIELD');

    expect(errorConfig.emitEvent).toHaveBeenCalledTimes(1);
    const event = errorConfig._events[0];
    expect(event.error).toBe('ER_BAD_FIELD');
    expect(event.duration).toBeGreaterThanOrEqual(0);

    unwrapMysqlPool(errorPool);
  });
});

// ── Callback-style ───────────────────────────────────────────

describe('wrapMysqlPool — callback-style', () => {
  it('wraps callback, emits event, calls original callback', () => {
    const pool: any = {
      query: vi.fn((sql: string, cb: Function) => {
        cb(null, [{ id: 1 }], [{ name: 'id' }]);
      }),
    };
    const config = createConfig();
    wrapMysqlPool(pool, config);

    const callback = vi.fn();
    pool.query('SELECT 1', callback);

    expect(callback).toHaveBeenCalledWith(null, [{ id: 1 }], [{ name: 'id' }]);
    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    expect(config._events[0].type).toBe('db-query');

    unwrapMysqlPool(pool);
  });

  it('emits error event in callback-style', () => {
    const pool: any = {
      query: vi.fn((sql: string, cb: Function) => {
        cb(new Error('cb-error'), null, null);
      }),
    };
    const config = createConfig();
    wrapMysqlPool(pool, config);

    const callback = vi.fn();
    pool.query('SELECT 1', callback);

    expect(callback).toHaveBeenCalled();
    expect(config._events[0].error).toBe('cb-error');

    unwrapMysqlPool(pool);
  });
});

// ── extractQueryText ─────────────────────────────────────────

describe('wrapMysqlPool — extractQueryText', () => {
  let config: ReturnType<typeof createConfig>;

  it('extracts query from string arg', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query('SELECT id FROM orders');

    expect(config._events[0].query).toContain('SELECT');
    unwrapMysqlPool(pool);
  });

  it('extracts query from {sql} object arg', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query({ sql: 'SELECT name FROM groups' } as any);

    expect(config._events[0].query).toContain('SELECT');
    unwrapMysqlPool(pool);
  });

  it('falls back to [unknown query] for unrecognized arg', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query(42 as any);

    expect(config._events[0].query).toContain('[unknown query]');
    unwrapMysqlPool(pool);
  });
});

// ── extractCallback ──────────────────────────────────────────

describe('wrapMysqlPool — extractCallback', () => {
  it('finds last function arg as callback', () => {
    const pool: any = {
      query: vi.fn((sql: string, params: any[], cb: Function) => {
        cb(null, [{ id: 1 }], []);
      }),
    };
    const config = createConfig();
    wrapMysqlPool(pool, config);

    const callback = vi.fn();
    pool.query('SELECT ?', [1], callback);

    expect(callback).toHaveBeenCalledOnce();
    unwrapMysqlPool(pool);
  });
});

// ── extractRowCount ──────────────────────────────────────────

describe('wrapMysqlPool — extractRowCount', () => {
  it('extracts from [rows, fields] array (SELECT)', async () => {
    const pool = createMockPool([[{ id: 1 }, { id: 2 }, { id: 3 }], []]);
    const config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query('SELECT * FROM t');

    expect(config._events[0].rowCount).toBe(3);
    unwrapMysqlPool(pool);
  });

  it('extracts from affectedRows on result (INSERT/UPDATE)', async () => {
    const pool = createMockPool([{ affectedRows: 7 }, []]);
    const config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query('UPDATE t SET x=1');

    expect(config._events[0].rowCount).toBe(7);
    unwrapMysqlPool(pool);
  });

  it('extracts from array length (callback-style rows)', () => {
    const pool: any = {
      query: vi.fn((sql: string, cb: Function) => {
        cb(null, [{ a: 1 }, { a: 2 }], []);
      }),
    };
    const config = createConfig();
    wrapMysqlPool(pool, config);

    pool.query('SELECT * FROM t', vi.fn());

    expect(config._events[0].rowCount).toBe(2);
    unwrapMysqlPool(pool);
  });
});

// ── normalizeAndTruncate ─────────────────────────────────────

describe('wrapMysqlPool — normalizeAndTruncate', () => {
  let config: ReturnType<typeof createConfig>;

  it('collapses whitespace', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query('SELECT   *   FROM    users');

    expect(config._events[0].query).toBe('SELECT * FROM users');
    unwrapMysqlPool(pool);
  });

  it('replaces string literals with ?', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query("SELECT * FROM users WHERE name = 'Alice'");

    expect(config._events[0].query).toContain('?');
    expect(config._events[0].query).not.toContain('Alice');
    unwrapMysqlPool(pool);
  });

  it('replaces numeric literals with ?', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    await pool.query('SELECT * FROM users WHERE age = 25');

    expect(config._events[0].query).toContain('?');
    expect(config._events[0].query).not.toContain('25');
    unwrapMysqlPool(pool);
  });

  it('truncates at 1000 chars', async () => {
    const pool = createMockPool();
    config = createConfig();
    wrapMysqlPool(pool, config);

    const longQuery = 'SELECT ' + 'x '.repeat(600);
    await pool.query(longQuery);

    expect(config._events[0].query.length).toBeLessThanOrEqual(1020);
    expect(config._events[0].query).toContain('... [truncated]');
    unwrapMysqlPool(pool);
  });
});
