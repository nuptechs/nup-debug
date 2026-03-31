// ============================================================
// Redis Interceptor — Comprehensive tests
// Wrap/unwrap, event emission, key extraction, operation mapping
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  wrapRedisClient,
  unwrapRedisClient,
} from '../../src/node/redis-interceptor.js';

// ── Mock Redis client factory ─────────────────────────────────

function createMockRedisClient() {
  return {
    get: vi.fn().mockResolvedValue('value'),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    hget: vi.fn().mockResolvedValue('field-value'),
    hset: vi.fn().mockResolvedValue(1),
    hdel: vi.fn().mockResolvedValue(1),
    lpush: vi.fn().mockResolvedValue(1),
    rpush: vi.fn().mockResolvedValue(1),
    lpop: vi.fn().mockResolvedValue('item'),
    rpop: vi.fn().mockResolvedValue('item'),
    sadd: vi.fn().mockResolvedValue(1),
    srem: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(300),
    incr: vi.fn().mockResolvedValue(2),
    decr: vi.fn().mockResolvedValue(0),
    mget: vi.fn().mockResolvedValue(['v1', 'v2']),
    mset: vi.fn().mockResolvedValue('OK'),
  };
}

function createConfig() {
  const events: any[] = [];
  return {
    emitEvent: vi.fn((e: any) => events.push(e)),
    sessionId: 'test-session',
    _events: events,
  };
}

// ── Wrapping & unwrapping ────────────────────────────────────

describe('wrapRedisClient', () => {
  it('wraps standard Redis commands', () => {
    const client = createMockRedisClient();
    const config = createConfig();
    const originalGet = client.get;

    wrapRedisClient(client, config);

    expect(client.get).not.toBe(originalGet);
    // cleanup
    unwrapRedisClient(client);
  });

  it('skips already-wrapped clients (idempotent)', () => {
    const client = createMockRedisClient();
    const config = createConfig();

    wrapRedisClient(client, config);
    const wrappedGet = client.get;

    wrapRedisClient(client, config);
    expect(client.get).toBe(wrappedGet);

    unwrapRedisClient(client);
  });
});

describe('unwrapRedisClient', () => {
  it('restores original methods (no longer wrapped)', async () => {
    const client = createMockRedisClient();
    const config = createConfig();

    wrapRedisClient(client, config);
    // Wrapped version should emit events
    await client.get('k');
    expect(config.emitEvent).toHaveBeenCalledTimes(1);

    unwrapRedisClient(client);
    // After unwrap, calling get should NOT emit additional events
    config.emitEvent.mockClear();
    await client.get('k');
    expect(config.emitEvent).not.toHaveBeenCalled();
  });

  it('is a no-op for non-wrapped clients', () => {
    const client = createMockRedisClient();
    const originalGet = client.get;

    unwrapRedisClient(client); // should not throw
    expect(client.get).toBe(originalGet);
  });
});

// ── Promise-style event emission ─────────────────────────────

describe('wrapRedisClient — promise-style', () => {
  let client: ReturnType<typeof createMockRedisClient>;
  let config: ReturnType<typeof createConfig>;

  beforeEach(() => {
    client = createMockRedisClient();
    config = createConfig();
    wrapRedisClient(client, config);
  });

  afterEach(() => {
    unwrapRedisClient(client);
  });

  it('emits event on successful get', async () => {
    await client.get('user:1');

    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    const event = config._events[0];
    expect(event.type).toBe('cache-op');
    expect(event.command).toBe('get');
    expect(event.key).toBe('user:1');
    expect(event.duration).toBeGreaterThanOrEqual(0);
    expect(event.error).toBeUndefined();
  });

  it('emits event on successful set', async () => {
    await client.set('key', 'val');

    const event = config._events[0];
    expect(event.command).toBe('set');
    expect(event.operation).toBe('set');
    expect(event.key).toBe('key');
  });

  it('emits event on error with error message and re-throws', async () => {
    // Create a client that rejects on get
    const errorClient: any = {
      get: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    };
    const errorConfig = createConfig();
    wrapRedisClient(errorClient, errorConfig);

    await expect(errorClient.get('broken-key')).rejects.toThrow('ECONNREFUSED');

    expect(errorConfig.emitEvent).toHaveBeenCalledTimes(1);
    const event = errorConfig._events[0];
    expect(event.error).toBe('ECONNREFUSED');
    expect(event.command).toBe('get');

    unwrapRedisClient(errorClient);
  });
});

// ── Callback-style ───────────────────────────────────────────

describe('wrapRedisClient — callback-style', () => {
  it('wraps callback, emits event, calls original callback', () => {
    const client: any = {
      get: vi.fn((_key: string, cb: Function) => {
        cb(null, 'result');
      }),
    };
    const config = createConfig();
    wrapRedisClient(client, config);

    const callback = vi.fn();
    client.get('mykey', callback);

    expect(callback).toHaveBeenCalledWith(null, 'result');
    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    const event = config._events[0];
    expect(event.command).toBe('get');
    expect(event.key).toBe('mykey');

    unwrapRedisClient(client);
  });

  it('emits error event in callback-style and passes error to callback', () => {
    const client: any = {
      get: vi.fn((_key: string, cb: Function) => {
        cb(new Error('cb-error'), null);
      }),
    };
    const config = createConfig();
    wrapRedisClient(client, config);

    const callback = vi.fn();
    client.get('key', callback);

    expect(callback).toHaveBeenCalled();
    expect(config._events[0].error).toBe('cb-error');

    unwrapRedisClient(client);
  });
});

// ── Synchronous return ───────────────────────────────────────

describe('wrapRedisClient — synchronous return', () => {
  it('emits event for synchronous results', () => {
    const client: any = {
      get: vi.fn(() => 'sync-value'), // returns plain value, not promise
    };
    const config = createConfig();
    wrapRedisClient(client, config);

    const result = client.get('sync-key');

    expect(result).toBe('sync-value');
    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    expect(config._events[0].key).toBe('sync-key');

    unwrapRedisClient(client);
  });
});

// ── Key truncation ───────────────────────────────────────────

describe('wrapRedisClient — key truncation', () => {
  it('truncates keys longer than MAX_KEY_LENGTH=256', async () => {
    const client = createMockRedisClient();
    const config = createConfig();
    wrapRedisClient(client, config);

    const longKey = 'k'.repeat(300);
    await client.get(longKey);

    const event = config._events[0];
    expect(event.key.length).toBeLessThanOrEqual(257); // 256 + '…'
    expect(event.key).toContain('…');

    unwrapRedisClient(client);
  });
});

// ── mapCommandToOperation ────────────────────────────────────

describe('wrapRedisClient — mapCommandToOperation', () => {
  let client: ReturnType<typeof createMockRedisClient>;
  let config: ReturnType<typeof createConfig>;

  beforeEach(() => {
    client = createMockRedisClient();
    config = createConfig();
    wrapRedisClient(client, config);
  });

  afterEach(() => {
    unwrapRedisClient(client);
  });

  it('maps get/hget/mget → "get"', async () => {
    await client.get('a');
    await client.hget('h', 'f');
    await client.mget(['a', 'b']);

    expect(config._events[0].operation).toBe('get');
    expect(config._events[1].operation).toBe('get');
    expect(config._events[2].operation).toBe('get');
  });

  it('maps set/hset/mset/lpush → "set"', async () => {
    await client.set('k', 'v');
    await client.hset('h', 'f', 'v');
    await client.mset({ a: '1', b: '2' });
    await client.lpush('list', 'item');

    expect(config._events[0].operation).toBe('set');
    expect(config._events[1].operation).toBe('set');
    expect(config._events[2].operation).toBe('set');
    expect(config._events[3].operation).toBe('set');
  });

  it('maps del/hdel/srem → "del"', async () => {
    await client.del('k');
    await client.hdel('h', 'f');
    await client.srem('s', 'm');

    expect(config._events[0].operation).toBe('del');
    expect(config._events[1].operation).toBe('del');
    expect(config._events[2].operation).toBe('del');
  });

  it('maps expire/ttl/incr/decr → "get" (default)', async () => {
    await client.expire('k', 60);
    await client.ttl('k');
    await client.incr('counter');
    await client.decr('counter');

    expect(config._events[0].operation).toBe('get');
    expect(config._events[1].operation).toBe('get');
    expect(config._events[2].operation).toBe('get');
    expect(config._events[3].operation).toBe('get');
  });
});

// ── extractKey ───────────────────────────────────────────────

describe('wrapRedisClient — extractKey', () => {
  let config: ReturnType<typeof createConfig>;

  afterEach(() => {});

  it('extracts key from mget with array', async () => {
    const client = createMockRedisClient();
    const conf = createConfig();
    wrapRedisClient(client, conf);

    await client.mget(['key1', 'key2', 'key3']);

    expect(conf._events[0].key).toBe('key1, key2, key3');
    unwrapRedisClient(client);
  });

  it('extracts key from mget with multiple string args', async () => {
    const client: any = {
      mget: vi.fn().mockResolvedValue(['v1', 'v2']),
    };
    const conf = createConfig();
    wrapRedisClient(client, conf);

    await client.mget('a', 'b');

    expect(conf._events[0].key).toBe('a, b');
    unwrapRedisClient(client);
  });

  it('extracts keys from mset with object', async () => {
    const client = createMockRedisClient();
    const conf = createConfig();
    wrapRedisClient(client, conf);

    await client.mset({ foo: 'bar', baz: 'qux' });

    expect(conf._events[0].key).toBe('foo, baz');
    unwrapRedisClient(client);
  });

  it('extracts keys from mset with interleaved args', async () => {
    const client: any = {
      mset: vi.fn().mockResolvedValue('OK'),
    };
    const conf = createConfig();
    wrapRedisClient(client, conf);

    await client.mset('k1', 'v1', 'k2', 'v2');

    expect(conf._events[0].key).toBe('k1, k2');
    unwrapRedisClient(client);
  });
});

// ── extractCallback ──────────────────────────────────────────

describe('wrapRedisClient — extractCallback', () => {
  it('finds function as last arg', () => {
    const client: any = {
      get: vi.fn((_key: string, cb: Function) => {
        cb(null, 'result');
      }),
    };
    const config = createConfig();
    wrapRedisClient(client, config);

    const callback = vi.fn();
    client.get('mykey', callback);

    // The original callback should have been called
    expect(callback).toHaveBeenCalledOnce();
    unwrapRedisClient(client);
  });

  it('does not treat non-function last arg as callback', async () => {
    const client = createMockRedisClient();
    const config = createConfig();
    wrapRedisClient(client, config);

    // Extra non-function args should not be treated as callback
    await client.set('k', 'v');

    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    unwrapRedisClient(client);
  });
});

// ── Import afterEach ─────────────────────────────────────────
import { afterEach } from 'vitest';
