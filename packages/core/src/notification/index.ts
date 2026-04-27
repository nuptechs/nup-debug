// ============================================================
// @nuptechs-probe/core — Notification module (webhook delivery)
// ============================================================

export { NotificationPort, NoopNotificationAdapter } from './notification.port.js';
export { WebhookEventStore, InMemoryWebhookEventStore, type WebhookEventListFilter } from './webhook-event-store.js';
export {
  PostgresWebhookEventStore,
  type PostgresWebhookEventStoreConfig,
} from './postgres-webhook-event-store.js';
export {
  WebhookNotificationAdapter,
  WEBHOOK_MAX_RETRIES,
  WEBHOOK_RETRY_SCHEDULE_MS,
  WEBHOOK_TIMEOUT_MS,
  type WebhookAdapterOptions,
} from './webhook.adapter.js';
export { isInternalUrl, isPrivateIPv4 } from './ssrf-guard.js';
export { signPayload, computeRetryDelay, type SignPayloadInput } from './webhook-signing.js';
export type { WebhookEvent, WebhookEventStatus, WebhookMetric, WebhookDeliveryOptions } from './types.js';
