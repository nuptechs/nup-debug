// ============================================================
// Webhook Notification — Types
// ============================================================

export type WebhookEventStatus = 'pending' | 'success' | 'failed' | 'dead_letter';

export interface WebhookEvent {
  readonly id: string;
  readonly targetUrl: string;
  readonly event: string;
  readonly payload: unknown;
  readonly status: WebhookEventStatus;
  readonly attempts: number;
  readonly lastAttemptAt: string | null;
  readonly errorMessage: string | null;
  readonly createdAt: string;
}

export interface WebhookDeliveryOptions {
  /** Correlation id used for the X-Webhook-Delivery header. Optional — one is generated if omitted. */
  deliveryId?: string;
}

export interface WebhookMetric {
  readonly type: 'delivery' | 'retry';
  readonly status: WebhookEventStatus;
  readonly event: WebhookEvent;
}
