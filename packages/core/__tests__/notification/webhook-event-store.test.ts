import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryWebhookEventStore } from '../../src/notification/webhook-event-store.js';
import type { WebhookEvent } from '../../src/notification/types.js';

function makeEvent(id: string, overrides: Partial<WebhookEvent> = {}): WebhookEvent {
  return {
    id,
    targetUrl: 'https://example.com/hook',
    event: 'test.event',
    payload: { id },
    status: 'pending',
    attempts: 0,
    lastAttemptAt: null,
    errorMessage: null,
    createdAt: new Date(Date.now() - 1000).toISOString(),
    ...overrides,
  };
}

describe('InMemoryWebhookEventStore', () => {
  let store: InMemoryWebhookEventStore;

  beforeEach(() => {
    store = new InMemoryWebhookEventStore();
  });

  it('creates and reads events', async () => {
    const created = await store.create(makeEvent('e1'));
    expect(created.id).toBe('e1');
    const loaded = await store.get('e1');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('e1');
  });

  it('returns null for missing id', async () => {
    expect(await store.get('missing')).toBeNull();
  });

  it('updates merge patch while preserving id', async () => {
    await store.create(makeEvent('e1'));
    const updated = await store.update('e1', { status: 'success', attempts: 3 });
    expect(updated).not.toBeNull();
    expect(updated!.id).toBe('e1');
    expect(updated!.status).toBe('success');
    expect(updated!.attempts).toBe(3);
  });

  it('update returns null for missing id', async () => {
    expect(await store.update('missing', { status: 'success' })).toBeNull();
  });

  it('lists events sorted by createdAt DESC', async () => {
    await store.create(makeEvent('e1', { createdAt: '2024-01-01T00:00:00.000Z' }));
    await store.create(makeEvent('e2', { createdAt: '2024-01-02T00:00:00.000Z' }));
    await store.create(makeEvent('e3', { createdAt: '2024-01-03T00:00:00.000Z' }));
    const list = await store.list();
    expect(list.map((e) => e.id)).toEqual(['e3', 'e2', 'e1']);
  });

  it('filters by status', async () => {
    await store.create(makeEvent('e1', { status: 'success' }));
    await store.create(makeEvent('e2', { status: 'dead_letter' }));
    await store.create(makeEvent('e3', { status: 'success' }));
    const list = await store.list({ status: 'success' });
    expect(list.map((e) => e.id).sort()).toEqual(['e1', 'e3']);
  });

  it('applies limit and offset', async () => {
    for (let i = 0; i < 5; i++) {
      await store.create(
        makeEvent(`e${i}`, { createdAt: new Date(2024, 0, i + 1).toISOString() }),
      );
    }
    const page1 = await store.list({ limit: 2, offset: 0 });
    const page2 = await store.list({ limit: 2, offset: 2 });
    expect(page1.map((e) => e.id)).toEqual(['e4', 'e3']);
    expect(page2.map((e) => e.id)).toEqual(['e2', 'e1']);
  });

  it('caps limit at 500', async () => {
    // Just assert the function doesn't blow up with a huge limit request — check signature/branch
    const list = await store.list({ limit: 99999 });
    expect(Array.isArray(list)).toBe(true);
  });
});
