// ============================================================
// Webhook Signing — HMAC-SHA256 with Stripe-style anti-replay
// ============================================================

import { createHmac } from 'node:crypto';

export interface SignPayloadInput {
  secret: string;
  /** Unix timestamp in seconds as a string. Included in the signed payload to prevent replay. */
  timestamp: string;
  body: string;
}

/** Returns `sha256=<hex>` signature for `${timestamp}.${body}`. */
export function signPayload({ secret, timestamp, body }: SignPayloadInput): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(`${timestamp}.${body}`);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Compute next-retry delay with ±20% jitter, floored at 1000ms.
 * Overflows clamp to the last schedule slot.
 * @param schedule Array of base delays in ms (attempt 0 -> schedule[0]).
 * @param attempt Zero-based attempt index of the upcoming retry.
 * @param rand Injectable randomness source (defaults to Math.random).
 */
export function computeRetryDelay(
  schedule: readonly number[],
  attempt: number,
  rand: () => number = Math.random,
): number {
  if (schedule.length === 0) return 1000;
  const idx = Math.min(Math.max(0, attempt), schedule.length - 1);
  const base = schedule[idx] ?? 1000;
  const jitter = base * 0.2 * (rand() * 2 - 1);
  return Math.max(1000, Math.round(base + jitter));
}
