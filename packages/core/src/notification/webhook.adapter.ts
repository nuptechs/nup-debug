// ============================================================
// WebhookNotificationAdapter — Hardened outbound webhook delivery.
// - SSRF guard on target URL
// - HMAC-SHA256 signature (Stripe-style, with timestamp anti-replay)
// - Persistent retry with exponential schedule + jitter
// - Dead-letter queue after MAX_RETRIES
// - Timeout via AbortController
// ============================================================

import { randomUUID } from 'node:crypto';
import { NotificationPort } from './notification.port.js';
import { type WebhookEventStore } from './webhook-event-store.js';
import { isInternalUrl } from './ssrf-guard.js';
import { signPayload, computeRetryDelay } from './webhook-signing.js';
import type { WebhookEvent, WebhookMetric } from './types.js';

/** Maximum number of delivery attempts before dead-lettering (1 initial + 5 retries). */
export const WEBHOOK_MAX_RETRIES = 5;

/** Exponential schedule: 1min, 5min, 30min, 2h, 12h. Overrides clamp to last slot. */
export const WEBHOOK_RETRY_SCHEDULE_MS = Object.freeze([
  60_000,
  300_000,
  1_800_000,
  7_200_000,
  43_200_000,
]);

/** Per-request timeout enforced by AbortController. */
export const WEBHOOK_TIMEOUT_MS = 30_000;

export interface WebhookAdapterOptions {
  readonly url: string;
  readonly secret: string;
  readonly timeoutMs?: number;
  /** If provided, deliveries are persisted and retry-capable. Omit for fire-and-forget. */
  readonly store?: WebhookEventStore;
  /** Inject a scheduler (for tests). Default uses `setTimeout`. */
  readonly scheduleRetry?: (fn: () => void, delayMs: number) => void;
  /** Inject randomness (for deterministic jitter in tests). */
  readonly rand?: () => number;
  /** Observer hook called on every terminal outcome (success / failed / dead_letter). */
  readonly onMetric?: (m: WebhookMetric) => void;
  /** User-Agent header — identifies this probe instance to webhook receivers. */
  readonly userAgent?: string;
}

interface PostResult {
  readonly ok: boolean;
  readonly status: number;
  readonly errorMessage: string | null;
}

export class WebhookNotificationAdapter extends NotificationPort {
  private readonly url: string;
  private readonly secret: string;
  private readonly timeoutMs: number;
  private readonly store: WebhookEventStore | null;
  private readonly scheduleRetry: (fn: () => void, delayMs: number) => void;
  private readonly rand: () => number;
  private readonly onMetric: ((m: WebhookMetric) => void) | null;
  private readonly userAgent: string;

  constructor(opts: WebhookAdapterOptions) {
    super();
    this.url = opts.url;
    this.secret = opts.secret;
    this.timeoutMs = opts.timeoutMs ?? WEBHOOK_TIMEOUT_MS;
    this.store = opts.store ?? null;
    this.scheduleRetry = opts.scheduleRetry ?? ((fn, ms) => { setTimeout(fn, ms).unref?.(); });
    this.rand = opts.rand ?? Math.random;
    this.onMetric = opts.onMetric ?? null;
    this.userAgent = opts.userAgent ?? 'probe-webhook/1.0';
  }

  isConfigured(): boolean {
    return Boolean(this.url) && Boolean(this.secret);
  }

  async notify(event: string, payload: unknown): Promise<boolean> {
    if (!this.isConfigured()) return false;

    if (isInternalUrl(this.url)) {
      // Refuse to deliver to internal / metadata hosts. Do not persist (no retry will ever succeed).
      return false;
    }

    if (this.store) {
      return this._deliverWithPersistence(event, payload);
    }
    return this._deliverLegacy(event, payload);
  }

  /** Fire-and-forget path used when no store is configured. */
  private async _deliverLegacy(event: string, payload: unknown): Promise<boolean> {
    const result = await this._post(event, payload, randomUUID());
    return result.ok;
  }

  /** Persistent path — creates a WebhookEvent and drives attempts + retries. */
  private async _deliverWithPersistence(event: string, payload: unknown): Promise<boolean> {
    if (!this.store) return false;
    const created = await this.store.create({
      id: randomUUID(),
      targetUrl: this.url,
      event,
      payload,
      status: 'pending',
      attempts: 0,
      lastAttemptAt: null,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    });
    await this._attemptDelivery(created.id);
    return true;
  }

  /** Attempt delivery for a persisted event, scheduling the next retry or dead-lettering as needed. */
  private async _attemptDelivery(eventId: string): Promise<void> {
    if (!this.store) return;
    const evt = await this.store.get(eventId);
    if (!evt) return;
    if (evt.status === 'success' || evt.status === 'dead_letter') return;

    const attemptNumber = evt.attempts + 1;
    const result = await this._post(evt.event, evt.payload, eventId);
    const lastAttemptAt = new Date().toISOString();

    if (result.ok) {
      const updated = await this.store.update(eventId, {
        status: 'success',
        attempts: attemptNumber,
        lastAttemptAt,
        errorMessage: null,
      });
      if (updated && this.onMetric) {
        this.onMetric({ type: 'delivery', status: 'success', event: updated });
      }
      return;
    }

    // Failure path
    if (attemptNumber >= WEBHOOK_MAX_RETRIES + 1) {
      // Exhausted: 1 initial + WEBHOOK_MAX_RETRIES retries
      const updated = await this.store.update(eventId, {
        status: 'dead_letter',
        attempts: attemptNumber,
        lastAttemptAt,
        errorMessage: result.errorMessage,
      });
      if (updated && this.onMetric) {
        this.onMetric({ type: 'delivery', status: 'dead_letter', event: updated });
      }
      return;
    }

    const updated = await this.store.update(eventId, {
      status: 'failed',
      attempts: attemptNumber,
      lastAttemptAt,
      errorMessage: result.errorMessage,
    });
    if (updated && this.onMetric) {
      this.onMetric({ type: 'delivery', status: 'failed', event: updated });
    }

    // attemptNumber counts THIS just-completed attempt. The next attempt is attemptNumber (0-indexed into schedule).
    // schedule[0] is the delay after the first failure.
    const delay = computeRetryDelay(WEBHOOK_RETRY_SCHEDULE_MS, attemptNumber - 1, this.rand);
    this.scheduleRetry(() => {
      void this._attemptDelivery(eventId);
    }, delay);
  }

  /**
   * Resume delivery of a previously persisted event WITHOUT resetting its
   * status/attempt counter. Used by boot-time recovery to continue pending
   * or failed deliveries after a restart — the retry schedule is honoured.
   */
  async resume(eventId: string): Promise<WebhookEvent | null> {
    if (!this.store) return null;
    const evt = await this.store.get(eventId);
    if (!evt) return null;
    if (evt.status === 'success' || evt.status === 'dead_letter') return evt;
    await this._attemptDelivery(eventId);
    return this.store.get(eventId);
  }

  /** Manual retry of a persisted event (e.g. from an admin route). */
  async retryDelivery(eventId: string): Promise<WebhookEvent | null> {
    if (!this.store) return null;
    const evt = await this.store.get(eventId);
    if (!evt) return null;
    if (evt.status === 'success') return evt;
    // Reset status so _attemptDelivery proceeds
    await this.store.update(eventId, { status: 'pending' });
    if (this.onMetric) {
      this.onMetric({ type: 'retry', status: 'pending', event: { ...evt, status: 'pending' } });
    }
    await this._attemptDelivery(eventId);
    return this.store.get(eventId);
  }

  /** POST with HMAC signature and AbortController timeout. Never throws. */
  private async _post(event: string, payload: unknown, deliveryId: string): Promise<PostResult> {
    const body = JSON.stringify({ event, data: payload, deliveryId });
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = signPayload({ secret: this.secret, timestamp, body });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent,
          'X-Probe-Event': event,
          'X-Probe-Delivery': deliveryId,
          'X-Probe-Timestamp': timestamp,
          'X-Probe-Signature': signature,
        },
        body,
        signal: controller.signal,
      });
      if (res.ok) {
        return { ok: true, status: res.status, errorMessage: null };
      }
      return {
        ok: false,
        status: res.status,
        errorMessage: `HTTP ${res.status}`,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, status: 0, errorMessage: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
