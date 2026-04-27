// ============================================================
// Notification Factory — Builds the NotificationPort from env
// Falls back to Noop when URL/secret are not configured.
// ============================================================

import {
  NotificationPort,
  NoopNotificationAdapter,
  WebhookNotificationAdapter,
  InMemoryWebhookEventStore,
  type WebhookEventStore,
  isInternalUrl,
} from '@nuptechs-probe/core';
import type { Logger } from 'pino';
import { webhookDeliveriesTotal } from './metrics.js';

/** Minimum webhook secret length enforced at startup. */
export const MIN_WEBHOOK_SECRET_LENGTH = 32;

export interface NotificationFactoryOptions {
  readonly url: string | undefined;
  readonly secret: string | undefined;
  readonly userAgent?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly store?: WebhookEventStore;
  readonly logger: Logger;
  /** If true, treat misconfiguration as fatal (production). Default false. */
  readonly strict?: boolean;
}

/**
 * Build the NotificationPort.
 *
 * Returns a `NoopNotificationAdapter` when `url` or `secret` is absent, unless
 * `strict` is true, in which case the caller is expected to `process.exit`.
 *
 * Guarantees:
 *  - Rejects secrets shorter than MIN_WEBHOOK_SECRET_LENGTH.
 *  - Rejects SSRF-suspicious internal URLs at startup (adapter also rejects at runtime).
 */
export function buildNotificationPort(opts: NotificationFactoryOptions): {
  notification: NotificationPort;
  store: WebhookEventStore | null;
} {
  const { url, secret, logger, strict = false } = opts;

  if (!url || !secret) {
    if (strict) {
      throw new Error('WEBHOOK_URL and WEBHOOK_SECRET are required');
    }
    logger.info('Webhook notifications disabled (WEBHOOK_URL or WEBHOOK_SECRET unset)');
    return { notification: new NoopNotificationAdapter(), store: null };
  }

  if (secret.length < MIN_WEBHOOK_SECRET_LENGTH) {
    throw new Error(
      `WEBHOOK_SECRET must be at least ${MIN_WEBHOOK_SECRET_LENGTH} characters`,
    );
  }

  if (isInternalUrl(url)) {
    throw new Error(`WEBHOOK_URL points to an internal/loopback/metadata host: ${url}`);
  }

  const store = opts.store ?? new InMemoryWebhookEventStore();

  const adapter = new WebhookNotificationAdapter({
    url,
    secret,
    store,
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    ...(opts.userAgent !== undefined ? { userAgent: opts.userAgent } : {}),
    onMetric: (m) => {
      webhookDeliveriesTotal.inc({ type: m.type, status: m.status });
    },
  });

  logger.info(
    { url, storeType: store.constructor.name, timeoutMs: opts.timeoutMs ?? 'default' },
    'Webhook notifications enabled',
  );

  return { notification: adapter, store };
}
