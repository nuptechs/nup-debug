// ============================================================
// NotificationPort — Abstraction for outbound notifications
// Adapters: Webhook (HTTP POST w/ HMAC), Noop
// ============================================================

export abstract class NotificationPort {
  /**
   * Deliver a notification. Implementations may be fire-and-forget or persist for retry.
   * Returns true if the delivery was accepted (not necessarily completed).
   */
  abstract notify(event: string, payload: unknown): Promise<boolean>;

  /** Returns true if the port is configured and will attempt real delivery. */
  abstract isConfigured(): boolean;
}

export class NoopNotificationAdapter extends NotificationPort {
  async notify(_event: string, _payload: unknown): Promise<boolean> {
    return false;
  }
  isConfigured(): boolean {
    return false;
  }
}
