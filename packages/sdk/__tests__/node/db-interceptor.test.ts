// ============================================================
// DB Query Interceptor — Comprehensive tests
// normalizeQuery, wrapPgPool, redactParams, event emission
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createDbQueryInterceptor,
  wrapPgPool,
  normalizeQuery,
} from '../../src/node/db-interceptor.js';
import { SdkEventCollector } from '../../src/node/event-collector.js';
import type { SdkConfig } from '@probe/core';

// ── Helpers ───────────────────────────────────────────────────

function makeSdkConfig(overrides?: Partial<SdkConfig>): SdkConfig {
  return {
    enabled: true,
    captureDbQueries: true,
    captureCache: false,
    captureCustomSpans: false,
    correlationHeader: 'x-correlation-id',
    sensitiveHeaders: ['authorization'],
    ...overrides,
  };
}

function createMockPool(queryResult: unknown = { rowCount: 5, rows: [] }) {
  return {
    query: vi.fn().mockResolvedValue(queryResult),
  };
}

// ── normalizeQuery ────────────────────────────────────────────

describe('normalizeQuery', () => {
  it('replaces string literals with $?', () => {
    const result = normalizeQuery("SELECT * FROM users WHERE name = 'Alice'");
    expect(result).toBe('SELECT * FROM users WHERE name = $?');
  });

  it('replaces numeric literals with $?', () => {
    const result = normalizeQuery('SELECT * FROM users WHERE age = 25');
    expect(result).toBe('SELECT * FROM users WHERE age = $?');
  });

  it('replaces decimal numeric literals with $?', () => {
    const result = normalizeQuery('SELECT * FROM items WHERE price > 19.99');
    expect(result).toBe('SELECT * FROM items WHERE price > $?');
  });

  it('preserves $N parameter placeholders', () => {
    const result = normalizeQuery('SELECT * FROM users WHERE id = $1 AND org = $2');
    expect(result).toBe('SELECT * FROM users WHERE id = $1 AND org = $2');
  });

  it('handles mixed literals and params', () => {
    const result = normalizeQuery("INSERT INTO logs (msg, level) VALUES ('hello', $1)");
    expect(result).toBe('INSERT INTO logs (msg, level) VALUES ($?, $1)');
  });

  it('handles query with no literals', () => {
    const result = normalizeQuery('SELECT $1, $2');
    expect(result).toBe('SELECT $1, $2');
  });
});

// ── createDbQueryInterceptor ──────────────────────────────────

describe('createDbQueryInterceptor', () => {
  it('creates interceptor with default collector', () => {
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config);
    expect(interceptor.collector).toBeInstanceOf(SdkEventCollector);
    expect(interceptor.config).toBe(config);
  });

  it('creates interceptor with provided collector', () => {
    const config = makeSdkConfig();
    const collector = new SdkEventCollector();
    const interceptor = createDbQueryInterceptor(config, collector);
    expect(interceptor.collector).toBe(collector);
  });
});

// ── wrapPgPool — bypass conditions ───────────────────────────

describe('wrapPgPool — bypass', () => {
  it('returns pool unchanged when config.enabled=false', () => {
    const pool = createMockPool();
    const originalQuery = pool.query;
    const config = makeSdkConfig({ enabled: false });
    const interceptor = createDbQueryInterceptor(config);

    const result = wrapPgPool(pool, interceptor);
    expect(result.query).toBe(originalQuery);
  });

  it('returns pool unchanged when captureDbQueries=false', () => {
    const pool = createMockPool();
    const originalQuery = pool.query;
    const config = makeSdkConfig({ captureDbQueries: false });
    const interceptor = createDbQueryInterceptor(config);

    const result = wrapPgPool(pool, interceptor);
    expect(result.query).toBe(originalQuery);
  });
});

// ── wrapPgPool — event emission ──────────────────────────────

describe('wrapPgPool — event emission', () => {
  let collector: SdkEventCollector;
  let events: any[];

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));
  });

  it('emits event on successful query with timing and rowCount', async () => {
    const pool = createMockPool({ rowCount: 3, rows: [{}, {}, {}] });
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT * FROM users');

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('db-query');
    expect(events[0].query).toBe('SELECT * FROM users');
    expect(events[0].rowCount).toBe(3);
    expect(events[0].duration).toBeGreaterThanOrEqual(0);
    expect(events[0].error).toBeUndefined();
  });

  it('emits event on error with error message', async () => {
    const pool = createMockPool();
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await expect(pool.query('SELECT 1')).rejects.toThrow('connection refused');

    expect(events).toHaveLength(1);
    expect(events[0].error).toBe('connection refused');
    expect(events[0].duration).toBeGreaterThanOrEqual(0);
  });

  it('re-throws errors after emitting', async () => {
    const pool = createMockPool();
    const err = new Error('boom');
    pool.query.mockRejectedValueOnce(err);
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await expect(pool.query('SELECT 1')).rejects.toThrow(err);
  });
});

// ── wrapPgPool — query truncation ────────────────────────────

describe('wrapPgPool — truncation', () => {
  let collector: SdkEventCollector;
  let events: any[];

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));
  });

  it('truncates queries longer than 1000 chars', async () => {
    const longQuery = 'SELECT ' + 'x'.repeat(2000);
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query(longQuery);

    expect(events[0].query.length).toBeLessThanOrEqual(1020); // 1000 + '... [truncated]'
    expect(events[0].query).toContain('... [truncated]');
  });

  it('does not truncate queries within limit', async () => {
    const shortQuery = 'SELECT 1';
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query(shortQuery);

    expect(events[0].query).toBe(shortQuery);
  });
});

// ── wrapPgPool — query text extraction ───────────────────────

describe('wrapPgPool — extractQueryText', () => {
  let collector: SdkEventCollector;
  let events: any[];

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));
  });

  it('extracts queryText from string arg', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT id FROM orders');
    expect(events[0].query).toBe('SELECT id FROM orders');
  });

  it('extracts queryText from {text} object arg', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query({ text: 'SELECT name FROM groups' });
    expect(events[0].query).toBe('SELECT name FROM groups');
  });

  it('falls back to [unknown query] for unrecognized arg', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query(42);
    expect(events[0].query).toBe('[unknown query]');
  });
});

// ── wrapPgPool — params extraction ──────────────────────────

describe('wrapPgPool — extractParams', () => {
  let collector: SdkEventCollector;
  let events: any[];

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));
  });

  it('extracts params from 2nd array arg', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', [42]);
    expect(events[0].params).toEqual([42]);
  });

  it('extracts params from {values} object arg', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query({ text: 'SELECT $1', values: ['abc'] });
    expect(events[0].params).toEqual(['abc']);
  });
});

// ── wrapPgPool — rowCount extraction ─────────────────────────

describe('wrapPgPool — extractRowCount', () => {
  let collector: SdkEventCollector;
  let events: any[];

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));
  });

  it('extracts rowCount from result.rowCount', async () => {
    const pool = createMockPool({ rowCount: 7 });
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT 1');
    expect(events[0].rowCount).toBe(7);
  });

  it('extracts rowCount from result.rows.length', async () => {
    const pool = createMockPool({ rows: [1, 2, 3] });
    const config = makeSdkConfig();
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT 1');
    expect(events[0].rowCount).toBe(3);
  });
});

// ── redactParams ─────────────────────────────────────────────

describe('redactParams', () => {
  let collector: SdkEventCollector;
  let events: any[];

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));
  });

  it('redacts Bearer tokens', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['placeholder'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['Bearer abc123.def.ghi']);
    expect(events[0].params[0]).toContain('[REDACTED]');
    expect(events[0].params[0]).not.toContain('abc123');
  });

  it('redacts JWT tokens', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['placeholder'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123']);
    expect(events[0].params[0]).toContain('[REDACTED]');
  });

  it('redacts credit card-like numbers', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['placeholder'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['4111-1111-1111-1111']);
    expect(events[0].params[0]).toContain('[REDACTED]');
    expect(events[0].params[0]).not.toContain('4111');
  });

  it('redacts SSN-like patterns', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['placeholder'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['123-45-6789']);
    expect(events[0].params[0]).toContain('[REDACTED]');
  });

  it('applies custom redactPatterns from config', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['secret-\\w+'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['my secret-value here']);
    expect(events[0].params[0]).toContain('[REDACTED]');
    expect(events[0].params[0]).not.toContain('secret-value');
  });

  it('skips overly long regex patterns (>500 chars)', async () => {
    const pool = createMockPool();
    const longPattern = 'a'.repeat(501);
    const config = makeSdkConfig({ redactPatterns: [longPattern] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['aaa']);
    // Should NOT crash and param remains untouched by the long pattern
    expect(events[0].params[0]).toBe('aaa');
  });

  it('skips ReDoS-prone regex patterns', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['(a+)+b'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['aaaaaaa']);
    // Should not hang — unsafe pattern skipped
    expect(events[0].params[0]).toBe('aaaaaaa');
  });

  it('leaves non-string params untouched', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig({ redactPatterns: ['\\d+'] });
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1, $2', [42, null]);
    expect(events[0].params).toEqual([42, null]);
  });

  it('returns params unchanged when no redactPatterns provided', async () => {
    const pool = createMockPool();
    const config = makeSdkConfig(); // no redactPatterns
    const interceptor = createDbQueryInterceptor(config, collector);
    wrapPgPool(pool, interceptor);

    await pool.query('SELECT $1', ['plain-text']);
    expect(events[0].params).toEqual(['plain-text']);
  });
});
