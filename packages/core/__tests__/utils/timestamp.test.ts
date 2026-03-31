import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nowMs, nowMicro, toIso, formatDuration, elapsed } from '../../src/utils/timestamp.js';

describe('nowMs', () => {
  it('returns current time close to Date.now()', () => {
    const before = Date.now();
    const result = nowMs();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it('returns a number', () => {
    expect(typeof nowMs()).toBe('number');
  });
});

describe('nowMicro', () => {
  it('returns a number in the microsecond range', () => {
    const ms = Date.now();
    const micro = nowMicro();
    // Should be roughly ms * 1000 (within 5s tolerance)
    expect(micro).toBeGreaterThan((ms - 5000) * 1000);
    expect(micro).toBeLessThan((ms + 5000) * 1000);
  });

  it('is monotonically increasing across calls', () => {
    const a = nowMicro();
    const b = nowMicro();
    expect(b).toBeGreaterThanOrEqual(a);
  });
});

describe('toIso', () => {
  it('converts epoch ms to ISO string', () => {
    // 2025-01-01T00:00:00.000Z
    expect(toIso(1735689600000)).toBe('2025-01-01T00:00:00.000Z');
  });

  it('handles zero', () => {
    expect(toIso(0)).toBe('1970-01-01T00:00:00.000Z');
  });
});

describe('formatDuration', () => {
  it('sub-millisecond → "<1ms"', () => {
    expect(formatDuration(0.5)).toBe('<1ms');
    expect(formatDuration(0)).toBe('<1ms');
  });

  it('milliseconds → "Xms"', () => {
    expect(formatDuration(1)).toBe('1ms');
    expect(formatDuration(500)).toBe('500ms');
    expect(formatDuration(999)).toBe('999ms');
  });

  it('seconds → "X.Ys"', () => {
    expect(formatDuration(1000)).toBe('1.0s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(59999)).toBe('60.0s');
  });

  it('minutes → "Xm Ys"', () => {
    expect(formatDuration(60_000)).toBe('1m 0s');
    expect(formatDuration(90_000)).toBe('1m 30s');
    expect(formatDuration(125_000)).toBe('2m 5s');
  });
});

describe('elapsed', () => {
  it('calculates difference between start and end', () => {
    expect(elapsed(100, 200)).toBe(100);
  });

  it('uses Date.now() when end is omitted', () => {
    const start = Date.now() - 50;
    const result = elapsed(start);
    expect(result).toBeGreaterThanOrEqual(50);
    expect(result).toBeLessThan(200); // generous tolerance
  });
});
