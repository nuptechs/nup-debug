// ============================================================
// MongoDB Interceptor — Comprehensive tests
// Wrap/unwrap, event emission, cursor wrapping, redaction
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  wrapMongoClient,
  unwrapMongoClient,
} from '../../src/node/mongo-interceptor.js';

// ── Mock MongoDB collection & client factory ─────────────────

function createMockCollection(name = 'users') {
  // Methods must live ONLY on the prototype so wrapMongoClient's
  // prototype patching takes effect (own properties shadow prototype).
  const sharedProto: any = {
    findOne: vi.fn().mockResolvedValue({ _id: '1', name: 'Alice' }),
    insertOne: vi.fn().mockResolvedValue({ acknowledged: true, insertedId: '1' }),
    insertMany: vi.fn().mockResolvedValue({ acknowledged: true, insertedIds: { 0: '1', 1: '2' } }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 5 }),
    deleteOne: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ deletedCount: 3 }),
    aggregate: vi.fn().mockResolvedValue([{ total: 10 }]),
    find: vi.fn().mockReturnValue({
      toArray: vi.fn().mockResolvedValue([{ _id: '1' }, { _id: '2' }]),
      next: vi.fn().mockResolvedValue({ _id: '1' }),
      forEach: vi.fn().mockImplementation(async (cb: Function) => {
        cb({ _id: '1' });
        cb({ _id: '2' });
      }),
    }),
  };

  const col: any = Object.create(sharedProto);
  col.collectionName = name;

  return { col, sharedProto };
}

function createMockMongoClient(overrideCol?: { col: any; sharedProto: any }) {
  const { col, sharedProto } = overrideCol ?? createMockCollection();

  const db: any = {
    collection: vi.fn(() => col),
  };

  const client: any = {
    db: vi.fn(() => db),
    _collection: col,
    _sharedProto: sharedProto,
  };

  return client;
}

function createConfig(opts: { redactParams?: boolean } = {}) {
  const events: any[] = [];
  return {
    emitEvent: vi.fn((e: any) => events.push(e)),
    sessionId: 'test-session',
    redactParams: opts.redactParams,
    _events: events,
  };
}

// ── Wrapping & unwrapping ────────────────────────────────────

describe('wrapMongoClient', () => {
  it('wraps collection prototype methods', () => {
    const client = createMockMongoClient();
    const originalFindOne = client._sharedProto.findOne;
    const config = createConfig();

    wrapMongoClient(client, config);

    expect(client._sharedProto.findOne).not.toBe(originalFindOne);
    unwrapMongoClient(client);
  });

  it('skips already-wrapped clients (idempotent)', () => {
    const client = createMockMongoClient();
    const config = createConfig();

    wrapMongoClient(client, config);
    const wrappedFindOne = client._sharedProto.findOne;

    wrapMongoClient(client, config);
    expect(client._sharedProto.findOne).toBe(wrappedFindOne);

    unwrapMongoClient(client);
  });

  it('returns client unchanged if db() is not available', () => {
    const client: any = {};
    const config = createConfig();
    const result = wrapMongoClient(client, config);
    expect(result).toBe(client);
  });
});

describe('unwrapMongoClient', () => {
  it('restores original prototype methods', () => {
    const client = createMockMongoClient();
    const originalFindOne = client._sharedProto.findOne;
    const config = createConfig();

    wrapMongoClient(client, config);
    expect(client._sharedProto.findOne).not.toBe(originalFindOne);

    unwrapMongoClient(client);
    expect(client._sharedProto.findOne).toBe(originalFindOne);
  });

  it('is a no-op for non-wrapped clients', () => {
    const client = createMockMongoClient();
    const originalFindOne = client._sharedProto.findOne;

    unwrapMongoClient(client);
    expect(client._sharedProto.findOne).toBe(originalFindOne);
  });
});

// ── Promise-style standard methods ───────────────────────────

describe('wrapMongoClient — promise-style methods', () => {
  let client: any;
  let config: ReturnType<typeof createConfig>;
  let col: any;

  beforeEach(() => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    col = client.db().collection('users');
  });

  afterEach(() => {
    unwrapMongoClient(client);
  });

  it('emits event on findOne success with documentCount', async () => {
    const result = await col.findOne({ name: 'Alice' });

    expect(result).toBeDefined();
    expect(config.emitEvent).toHaveBeenCalledTimes(1);
    const event = config._events[0];
    expect(event.type).toBe('db-query');
    expect(event.operation).toBe('findOne');
    expect(event.collection).toBe('users');
    expect(event.documentCount).toBe(1);
    expect(event.duration).toBeGreaterThanOrEqual(0);
  });

  it('emits event for findOne returning null (count=0)', async () => {
    // Create a separate client whose findOne returns null
    const nullProto: any = {
      findOne: vi.fn().mockResolvedValue(null),
    };
    const nullCol: any = Object.create(nullProto);
    nullCol.collectionName = 'users';
    const nullClient = createMockMongoClient({ col: nullCol, sharedProto: nullProto });
    const nullConfig = createConfig();
    wrapMongoClient(nullClient, nullConfig);
    const col2 = nullClient.db().collection('users');

    await col2.findOne({ name: 'Ghost' });

    const event = nullConfig._events[0];
    expect(event.documentCount).toBe(0);
    unwrapMongoClient(nullClient);
  });

  it('emits event on insertOne success', async () => {
    await col.insertOne({ name: 'Bob' });

    const event = config._events[0];
    expect(event.operation).toBe('insertOne');
    expect(event.documentCount).toBe(1);
  });

  it('emits event on insertMany with document count from args', async () => {
    await col.insertMany([{ a: 1 }, { b: 2 }, { c: 3 }]);

    const event = config._events[0];
    expect(event.operation).toBe('insertMany');
    expect(event.documentCount).toBe(3);
  });

  it('emits event on updateOne with modifiedCount', async () => {
    await col.updateOne({ _id: '1' }, { $set: { name: 'Updated' } });

    const event = config._events[0];
    expect(event.operation).toBe('updateOne');
    expect(event.documentCount).toBe(1);
  });

  it('emits event on updateMany with modifiedCount', async () => {
    await col.updateMany({}, { $set: { active: true } });

    const event = config._events[0];
    expect(event.operation).toBe('updateMany');
    expect(event.documentCount).toBe(5);
  });

  it('emits event on deleteOne with deletedCount', async () => {
    await col.deleteOne({ _id: '1' });

    const event = config._events[0];
    expect(event.operation).toBe('deleteOne');
    expect(event.documentCount).toBe(1);
  });

  it('emits event on deleteMany with deletedCount', async () => {
    await col.deleteMany({ active: false });

    const event = config._events[0];
    expect(event.operation).toBe('deleteMany');
    expect(event.documentCount).toBe(3);
  });

  it('emits event on aggregate', async () => {
    await col.aggregate([{ $match: {} }]);

    const event = config._events[0];
    expect(event.operation).toBe('aggregate');
  });

  it('emits event on error with error message and re-throws', async () => {
    const errProto: any = {
      findOne: vi.fn().mockRejectedValue(new Error('MongoError')),
    };
    const errCol: any = Object.create(errProto);
    errCol.collectionName = 'users';
    const errClient = createMockMongoClient({ col: errCol, sharedProto: errProto });
    const errConfig = createConfig();
    wrapMongoClient(errClient, errConfig);
    const errCollection = errClient.db().collection('users');

    await expect(errCollection.findOne({ _id: '1' })).rejects.toThrow('MongoError');

    const event = errConfig._events[0];
    expect(event.error).toBe('MongoError');
    unwrapMongoClient(errClient);
  });
});

// ── find() cursor wrapping ──────────────────────────────────

describe('wrapMongoClient — find cursor', () => {
  let client: any;
  let config: ReturnType<typeof createConfig>;

  afterEach(() => {
    unwrapMongoClient(client);
  });

  it('wraps find().toArray() and emits event with document count', async () => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    const cursor = col.find({ active: true });
    const docs = await cursor.toArray();

    expect(docs).toHaveLength(2);
    expect(config.emitEvent).toHaveBeenCalled();
    const event = config._events.find((e: any) => e.operation === 'find');
    expect(event).toBeDefined();
    expect(event.documentCount).toBe(2);
  });

  it('wraps find().next() and emits event with count=1', async () => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    const cursor = col.find({});
    const doc = await cursor.next();

    expect(doc).toBeDefined();
    const event = config._events.find((e: any) => e.operation === 'find.next');
    expect(event).toBeDefined();
    expect(event.documentCount).toBe(1);
  });

  it('wraps find().next() returning null — emits count=0', async () => {
    const sharedProto: any = {
      find: vi.fn().mockReturnValue({
        toArray: vi.fn().mockResolvedValue([]),
        next: vi.fn().mockResolvedValue(null),
        forEach: vi.fn(),
      }),
    };
    const nullCol: any = Object.create(sharedProto);
    nullCol.collectionName = 'users';
    client = createMockMongoClient({ col: nullCol, sharedProto });
    config = createConfig();
    wrapMongoClient(client, config);
    const c = client.db().collection('users');

    const cursor = c.find({});
    const doc = await cursor.next();

    expect(doc).toBeNull();
    const event = config._events.find((e: any) => e.operation === 'find.next');
    expect(event.documentCount).toBe(0);
  });

  it('wraps find().forEach() and counts documents', async () => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    const cursor = col.find({});
    const collected: any[] = [];
    await cursor.forEach((doc: any) => collected.push(doc));

    const event = config._events.find((e: any) => e.operation === 'find.forEach');
    expect(event).toBeDefined();
    expect(event.documentCount).toBe(2);
  });
});

// ── redactFilter ─────────────────────────────────────────────

describe('wrapMongoClient — redactFilter', () => {
  let client: any;

  afterEach(() => {
    unwrapMongoClient(client);
  });

  it('replaces leaf values with [REDACTED] by default', async () => {
    client = createMockMongoClient();
    const config = createConfig(); // redactParams defaults to true
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.findOne({ email: 'alice@test.com', age: 25 });

    const event = config._events[0];
    expect(event.filter).toEqual({
      email: '[REDACTED]',
      age: '[REDACTED]',
    });
  });

  it('preserves nested object structure', async () => {
    client = createMockMongoClient();
    const config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.findOne({ $and: [{ active: true }, { role: 'admin' }] });

    const event = config._events[0];
    // $and is an array of objects — structure should be preserved
    expect(event.filter).toHaveProperty('$and');
    expect(Array.isArray(event.filter.$and)).toBe(true);
    expect(event.filter.$and[0]).toEqual({ active: '[REDACTED]' });
    expect(event.filter.$and[1]).toEqual({ role: '[REDACTED]' });
  });

  it('passes filter unredacted when redactParams=false', async () => {
    client = createMockMongoClient();
    const config = createConfig({ redactParams: false });
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.findOne({ email: 'alice@test.com' });

    const event = config._events[0];
    expect(event.filter).toEqual({ email: 'alice@test.com' });
  });
});

// ── extractDocumentCount per operation ───────────────────────

describe('wrapMongoClient — extractDocumentCount', () => {
  let client: any;
  let config: ReturnType<typeof createConfig>;

  afterEach(() => {
    unwrapMongoClient(client);
  });

  it('findOne returns 1 for truthy result, 0 for null', async () => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.findOne({});
    expect(config._events[0].documentCount).toBe(1);
  });

  it('updateOne returns modifiedCount', async () => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.updateOne({}, { $set: { x: 1 } });
    expect(config._events[0].documentCount).toBe(1);
  });

  it('deleteMany returns deletedCount', async () => {
    client = createMockMongoClient();
    config = createConfig();
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.deleteMany({});
    expect(config._events[0].documentCount).toBe(3);
  });
});

// ── extractFilter per method ─────────────────────────────────

describe('wrapMongoClient — extractFilter', () => {
  let client: any;
  let config: ReturnType<typeof createConfig>;

  afterEach(() => {
    unwrapMongoClient(client);
  });

  it('findOne extracts first arg as filter', async () => {
    client = createMockMongoClient();
    config = createConfig({ redactParams: false });
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.findOne({ _id: 'abc' });
    expect(config._events[0].filter).toEqual({ _id: 'abc' });
  });

  it('insertOne has no filter (undefined)', async () => {
    client = createMockMongoClient();
    config = createConfig({ redactParams: false });
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.insertOne({ name: 'X' });
    expect(config._events[0].filter).toBeUndefined();
  });

  it('aggregate extracts pipeline as filter', async () => {
    client = createMockMongoClient();
    config = createConfig({ redactParams: false });
    wrapMongoClient(client, config);
    const col = client.db().collection('users');

    await col.aggregate([{ $match: { active: true } }]);
    expect(config._events[0].filter).toEqual([{ $match: { active: true } }]);
  });
});
