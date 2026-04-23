import { describe, it, expect } from 'vitest';
import { signPayload, computeRetryDelay } from '../../src/notification/webhook-signing.js';
import { createHmac } from 'node:crypto';

describe('signPayload', () => {
  it('produces sha256=<hex> signature over `${timestamp}.${body}`', () => {
    const secret = 'shhh';
    const timestamp = '1700000000';
    const body = JSON.stringify({ hello: 'world' });
    const actual = signPayload({ secret, timestamp, body });

    const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
    expect(actual).toBe(expected);
  });

  it('changes when timestamp changes (prevents replay)', () => {
    const body = '{"a":1}';
    const a = signPayload({ secret: 'k', timestamp: '1', body });
    const b = signPayload({ secret: 'k', timestamp: '2', body });
    expect(a).not.toBe(b);
  });

  it('changes when body changes', () => {
    const a = signPayload({ secret: 'k', timestamp: '1', body: 'a' });
    const b = signPayload({ secret: 'k', timestamp: '1', body: 'b' });
    expect(a).not.toBe(b);
  });
});

describe('computeRetryDelay', () => {
  const schedule = [1000, 5000, 30000] as const;

  it('uses schedule[attempt] as base', () => {
    // rand=0.5 → jitter factor = base * 0.2 * 0 = 0
    expect(computeRetryDelay(schedule, 0, () => 0.5)).toBe(1000);
    expect(computeRetryDelay(schedule, 1, () => 0.5)).toBe(5000);
    expect(computeRetryDelay(schedule, 2, () => 0.5)).toBe(30000);
  });

  it('applies +20% jitter at rand=1', () => {
    // +20% of 5000 = 1000 → 6000
    expect(computeRetryDelay(schedule, 1, () => 1)).toBe(6000);
  });

  it('applies -20% jitter at rand=0', () => {
    // -20% of 5000 = -1000 → 4000
    expect(computeRetryDelay(schedule, 1, () => 0)).toBe(4000);
  });

  it('floors at 1000ms even if jitter would go lower', () => {
    const shortSchedule = [500];
    expect(computeRetryDelay(shortSchedule, 0, () => 0)).toBe(1000);
  });

  it('clamps attempts beyond schedule length to last slot', () => {
    expect(computeRetryDelay(schedule, 99, () => 0.5)).toBe(30000);
  });

  it('handles empty schedule', () => {
    expect(computeRetryDelay([], 0)).toBe(1000);
  });
});
