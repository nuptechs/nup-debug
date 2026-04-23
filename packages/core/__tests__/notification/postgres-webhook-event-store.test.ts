// ============================================================
// PostgresWebhookEventStore — covers create/get/update/list and
// listUnfinished with an injected mock pg.Pool.
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PostgresWebhookEventStore } from '../../src/notification/postgres-webhook-event-store.js';
import type { WebhookEvent } from '../../src/notification/types.js';

interface Row {
  id: string;
  target_url: string;
  event: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_attempt_at: Date | null;
  error_message: string | null;
  created_at: Date;
}

/** Minimal in-memory pg.Pool shim that understands the queries the store issues. */
function createFakePool() {
  const rows: Row[] = [];
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });

    if (sql.includes('pg_advisory_lock') || sql.includes('pg_advisory_unlock')) {
      return { rows: [] };
    }
    if (sql.includes('CREATE TABLE')) {
      return { rows: [] };
    }

    if (sql.startsWith('INSERT INTO probe_webhook_events')) {
      const [id, target_url, event, payload, status, attempts, last_attempt_at, error_message, created_at] =
        params as [string, string, string, string, string, number, Date | null, string | null, Date];
      const row: Row = {
        id,
        target_url,
        event,
        payload: JSON.parse(payload),
        status,
        attempts,
        last_attempt_at,
        error_message,
        created_at,
      };
      rows.push(row);
      return { rows: [row] };
    }

    if (sql.includes('SELECT * FROM probe_webhook_events WHERE id =')) {
      const [id] = params as [string];
      const found = rows.find((r) => r.id === id);
      return { rows: found ? [found] : [] };
    }

    if (sql.startsWith('UPDATE probe_webhook_events SET')) {
      const id = params[params.length - 1] as string;
      const row = rows.find((r) => r.id === id);
      if (!row) return { rows: [] };
      // Apply set clauses in order — parse the column names from the SQL
      const setClause = sql.substring(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE'));
      const assigns = setClause.split(',').map((s) => s.trim());
      assigns.forEach((assign, i) => {
        const col = assign.split('=')[0]!.trim();
        const val = params[i];
        (row as unknown as Record<string, unknown>)[col] =
          col === 'payload' ? JSON.parse(val as string) : val;
      });
      return { rows: [row] };
    }

    if (sql.includes("WHERE status IN ('pending', 'failed')")) {
      const [limit] = params as [number];
      const filtered = rows
        .filter((r) => r.status === 'pending' || r.status === 'failed')
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .slice(0, limit);
      return { rows: filtered };
    }

    if (sql.includes('WHERE status = $1')) {
      const [status, limit, offset] = params as [string, number, number];
      const filtered = rows
        .filter((r) => r.status === status)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows: filtered };
    }

    if (sql.includes('ORDER BY created_at DESC')) {
      const [limit, offset] = params as [number, number];
      const sorted = [...rows]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(offset, offset + limit);
      return { rows: sorted };
    }

    return { rows: [] };
  });

  const client = { query, release: vi.fn() };
  const pool = {
    connect: vi.fn(async () => client),
    query,
    end: vi.fn(),
  };

  return { pool, rows, calls };
}

function seedEvent(overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    targetUrl: 'https://hook.example.com/path',
    event: 'session.created',
    payload: { foo: 'bar' },
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    errorMessage: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('PostgresWebhookEventStore', () => {
  let fake: ReturnType<typeof createFakePool>;
  let store: PostgresWebhookEventStore;

  beforeEach(async () => {
    fake = createFakePool();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    store = new PostgresWebhookEventStore({ pool: fake.pool as any });
    await store.initialize();
  });

  it('creates and retrieves an event', async () => {
    const evt = seedEvent();
    const created = await store.create(evt);
    expect(created.id).toBe(evt.id);
    const fetched = await store.get(evt.id);
    expect(fetched).toMatchObject({ id: evt.id, status: 'pending', attempts: 0 });
  });

  it('returns null for unknown id', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('updates status, attempts and errorMessage', async () => {
    const evt = await store.create(seedEvent());
    const updated = await store.update(evt.id, {
      status: 'failed',
      attempts: 2,
      errorMessage: 'boom',
      lastAttemptAt: new Date().toISOString(),
    });
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe('failed');
    expect(updated!.attempts).toBe(2);
    expect(updated!.errorMessage).toBe('boom');
  });

  it('returns null when updating unknown id', async () => {
    expect(await store.update('missing', { status: 'success' })).toBeNull();
  });

  it('lists events in DESC order', async () => {
    const a = await store.create(seedEvent({ createdAt: new Date(Date.now() - 2000).toISOString() }));
    const b = await store.create(seedEvent({ createdAt: new Date(Date.now() - 1000).toISOString() }));
    const c = await store.create(seedEvent({ createdAt: new Date().toISOString() }));
    const list = await store.list();
    expect(list.map((e) => e.id)).toEqual([c.id, b.id, a.id]);
  });

  it('filters list by status', async () => {
    await store.create(seedEvent({ status: 'success' }));
    await store.create(seedEvent({ status: 'failed' }));
    await store.create(seedEvent({ status: 'failed' }));
    const failed = await store.list({ status: 'failed' });
    expect(failed).toHaveLength(2);
    expect(failed.every((e) => e.status === 'failed')).toBe(true);
  });

  it('listUnfinished returns pending + failed, excluding success and dead_letter', async () => {
    await store.create(seedEvent({ status: 'success' }));
    await store.create(seedEvent({ status: 'dead_letter' }));
    const pending = await store.create(seedEvent({ status: 'pending' }));
    const failed = await store.create(seedEvent({ status: 'failed' }));

    const unfinished = await store.listUnfinished();
    const ids = unfinished.map((e) => e.id).sort();
    expect(ids).toEqual([pending.id, failed.id].sort());
  });

  it('throws if used before initialize', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uninit = new PostgresWebhookEventStore({ pool: fake.pool as any });
    await expect(uninit.get('x')).rejects.toThrow(/not initialized/);
  });
});
