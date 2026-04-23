import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  WebhookNotificationAdapter,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_SCHEDULE_MS,
} from '../../src/notification/webhook.adapter.js';
import { InMemoryWebhookEventStore } from '../../src/notification/webhook-event-store.js';
import type { WebhookMetric } from '../../src/notification/types.js';

/** Fake fetch that returns queued responses in order; tracks captured requests. */
function createFetchHarness() {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const queue: Array<Response | Error> = [];

  const fakeFetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.shift();
    if (!next) throw new Error('fake-fetch: no queued response');
    if (next instanceof Error) throw next;
    return next;
  });

  return {
    fakeFetch,
    calls,
    queueOk: (body = ''): void => { queue.push(new Response(body, { status: 200 })); },
    queueFail: (status = 500): void => { queue.push(new Response('err', { status })); },
    queueError: (err: Error): void => { queue.push(err); },
  };
}

/** Capture scheduled retries so tests can advance them deterministically. */
function captureScheduler() {
  const scheduled: Array<{ fn: () => void; delay: number }> = [];
  const scheduleRetry = (fn: () => void, delay: number): void => {
    scheduled.push({ fn, delay });
  };
  return { scheduled, scheduleRetry };
}

/** Flush queued microtasks so async chains complete. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('WebhookNotificationAdapter', () => {
  let harness: ReturnType<typeof createFetchHarness>;

  beforeEach(() => {
    harness = createFetchHarness();
    vi.stubGlobal('fetch', harness.fakeFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isConfigured', () => {
    it('is false without url or secret', () => {
      expect(new WebhookNotificationAdapter({ url: '', secret: '' }).isConfigured()).toBe(false);
      expect(new WebhookNotificationAdapter({ url: 'https://x.io/h', secret: '' }).isConfigured()).toBe(false);
      expect(new WebhookNotificationAdapter({ url: '', secret: 'k' }).isConfigured()).toBe(false);
    });

    it('is true when both set', () => {
      expect(
        new WebhookNotificationAdapter({ url: 'https://x.io/h', secret: 'k' }).isConfigured(),
      ).toBe(true);
    });
  });

  describe('SSRF guard', () => {
    it('refuses internal URLs and does not fire fetch', async () => {
      const adapter = new WebhookNotificationAdapter({
        url: 'http://169.254.169.254/latest/meta-data/',
        secret: 'k',
      });
      const ok = await adapter.notify('evt', { a: 1 });
      expect(ok).toBe(false);
      expect(harness.fakeFetch).not.toHaveBeenCalled();
    });
  });

  describe('legacy mode (no store)', () => {
    it('returns true on 200', async () => {
      harness.queueOk();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
      });
      expect(await adapter.notify('evt', { a: 1 })).toBe(true);
      expect(harness.fakeFetch).toHaveBeenCalledTimes(1);
    });

    it('returns false on non-2xx and does not retry without a store', async () => {
      harness.queueFail(500);
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
      });
      expect(await adapter.notify('evt', { a: 1 })).toBe(false);
      expect(harness.fakeFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('HMAC signature', () => {
    it('signs with timestamp prefix reconstructible from header', async () => {
      harness.queueOk();
      const secret = 'shhh';
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret,
      });
      await adapter.notify('order.paid', { id: 1 });

      const call = harness.calls[0];
      expect(call).toBeDefined();
      const headers = call!.init.headers as Record<string, string>;
      const timestamp = headers['X-Probe-Timestamp'];
      const signature = headers['X-Probe-Signature'];
      const body = call!.init.body as string;

      expect(timestamp).toBeDefined();
      expect(signature).toBeDefined();
      const expected = `sha256=${createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex')}`;
      expect(signature).toBe(expected);
      expect(headers['User-Agent']).toBeDefined();
      expect(headers['X-Probe-Event']).toBe('order.paid');
      expect(headers['X-Probe-Delivery']).toBeDefined();
    });
  });

  describe('persistent mode', () => {
    it('persists success with attempts=1 and emits success metric', async () => {
      harness.queueOk();
      const store = new InMemoryWebhookEventStore();
      const metrics: WebhookMetric[] = [];
      const { scheduled, scheduleRetry } = captureScheduler();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
        store,
        scheduleRetry,
        rand: () => 0.5,
        onMetric: (m) => metrics.push(m),
      });
      expect(await adapter.notify('evt', { ok: true })).toBe(true);
      await flushMicrotasks();

      const list = await store.list();
      expect(list).toHaveLength(1);
      expect(list[0]!.status).toBe('success');
      expect(list[0]!.attempts).toBe(1);
      expect(list[0]!.lastAttemptAt).not.toBeNull();
      expect(scheduled).toHaveLength(0);
      expect(metrics).toHaveLength(1);
      expect(metrics[0]!.status).toBe('success');
    });

    it('persists failure, schedules retry with schedule[0] delay (±20%)', async () => {
      harness.queueFail(503);
      const store = new InMemoryWebhookEventStore();
      const { scheduled, scheduleRetry } = captureScheduler();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
        store,
        scheduleRetry,
        rand: () => 0.5,
      });
      await adapter.notify('evt', { x: 1 });
      await flushMicrotasks();

      const list = await store.list();
      expect(list[0]!.status).toBe('failed');
      expect(list[0]!.attempts).toBe(1);
      expect(list[0]!.errorMessage).toContain('503');
      expect(scheduled).toHaveLength(1);
      // rand=0.5 → jitter=0 → exact schedule[0]
      expect(scheduled[0]!.delay).toBe(WEBHOOK_RETRY_SCHEDULE_MS[0]);
    });

    it('dead-letters after MAX_RETRIES+1 total attempts', async () => {
      const totalAttempts = WEBHOOK_MAX_RETRIES + 1;
      for (let i = 0; i < totalAttempts; i++) harness.queueFail(500);

      const store = new InMemoryWebhookEventStore();
      const metrics: WebhookMetric[] = [];
      const { scheduled, scheduleRetry } = captureScheduler();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
        store,
        scheduleRetry,
        rand: () => 0.5,
        onMetric: (m) => metrics.push(m),
      });
      await adapter.notify('evt', { x: 1 });
      await flushMicrotasks();

      // Drain scheduled retries one by one
      while (scheduled.length > 0) {
        const next = scheduled.shift()!;
        next.fn();
        await flushMicrotasks();
      }

      const list = await store.list();
      expect(list[0]!.status).toBe('dead_letter');
      expect(list[0]!.attempts).toBe(totalAttempts);
      expect(harness.fakeFetch).toHaveBeenCalledTimes(totalAttempts);
      expect(metrics.filter((m) => m.status === 'dead_letter')).toHaveLength(1);
    });

    it('succeeds on a later retry and stops scheduling', async () => {
      harness.queueFail(500);
      harness.queueFail(500);
      harness.queueOk();

      const store = new InMemoryWebhookEventStore();
      const { scheduled, scheduleRetry } = captureScheduler();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
        store,
        scheduleRetry,
        rand: () => 0.5,
      });
      await adapter.notify('evt', { x: 1 });
      await flushMicrotasks();

      // Drain retries until success
      while (scheduled.length > 0) {
        const next = scheduled.shift()!;
        next.fn();
        await flushMicrotasks();
      }

      const list = await store.list();
      expect(list[0]!.status).toBe('success');
      expect(list[0]!.attempts).toBe(3);
      expect(harness.fakeFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('retryDelivery', () => {
    it('manually retries a failed event', async () => {
      harness.queueFail(500);
      harness.queueOk();
      const store = new InMemoryWebhookEventStore();
      const { scheduled, scheduleRetry } = captureScheduler();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
        store,
        scheduleRetry,
        rand: () => 0.5,
      });
      await adapter.notify('evt', { x: 1 });
      await flushMicrotasks();
      // Discard auto-scheduled retry — we retry manually instead
      scheduled.length = 0;

      const list = await store.list();
      const id = list[0]!.id;
      const after = await adapter.retryDelivery(id);
      await flushMicrotasks();
      expect(after).not.toBeNull();
      expect(after!.status).toBe('success');
    });

    it('returns null for unknown id', async () => {
      const store = new InMemoryWebhookEventStore();
      const adapter = new WebhookNotificationAdapter({
        url: 'https://hook.example.com/',
        secret: 'k',
        store,
      });
      expect(await adapter.retryDelivery('missing')).toBeNull();
    });
  });
});
