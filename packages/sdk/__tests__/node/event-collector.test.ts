// ============================================================
// SDK Event Collector — Comprehensive tests
// Buffering, handlers, stats, buffer cap, reset
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SdkEventCollector } from '../../src/node/event-collector.js';

// ── Helpers ───────────────────────────────────────────────────

function makePartialEvent(overrides?: Record<string, unknown>) {
  return {
    type: 'custom' as const,
    correlationId: 'test-corr',
    name: 'test-event',
    ...overrides,
  };
}

// ── emit — buffering ─────────────────────────────────────────

describe('SdkEventCollector — emit buffering', () => {
  let collector: SdkEventCollector;

  beforeEach(() => {
    collector = new SdkEventCollector();
  });

  it('buffers events when no handler is registered', () => {
    collector.emit(makePartialEvent());
    collector.emit(makePartialEvent());

    const flushed = collector.flush();
    expect(flushed).toHaveLength(2);
  });

  it('buffered events have id, sessionId, timestamp, source fields', () => {
    collector.setSessionId('sess-1');
    collector.emit(makePartialEvent());

    const flushed = collector.flush();
    expect(flushed[0]).toMatchObject({
      id: expect.any(String),
      sessionId: 'sess-1',
      timestamp: expect.any(Number),
      source: 'sdk',
      type: 'custom',
    });
  });
});

// ── emit — immediate dispatch ────────────────────────────────

describe('SdkEventCollector — emit with handler', () => {
  let collector: SdkEventCollector;

  beforeEach(() => {
    collector = new SdkEventCollector();
  });

  it('sends events to handlers immediately when registered', () => {
    const handler = vi.fn();
    collector.onEvent(handler);

    collector.emit(makePartialEvent());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'custom', source: 'sdk' }),
    );
  });

  it('sends events to all registered handlers', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    collector.onEvent(handler1);
    collector.onEvent(handler2);

    collector.emit(makePartialEvent());

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
  });
});

// ── onEvent — flush & unsubscribe ────────────────────────────

describe('SdkEventCollector — onEvent', () => {
  let collector: SdkEventCollector;

  beforeEach(() => {
    collector = new SdkEventCollector();
  });

  it('flushes buffered events to new handler immediately', () => {
    collector.emit(makePartialEvent({ name: 'ev1' }));
    collector.emit(makePartialEvent({ name: 'ev2' }));

    const handler = vi.fn();
    collector.onEvent(handler);

    expect(handler).toHaveBeenCalledTimes(2);
    // Buffer should be empty now
    expect(collector.flush()).toHaveLength(0);
  });

  it('returns unsubscribe function', () => {
    const handler = vi.fn();
    const unsub = collector.onEvent(handler);

    collector.emit(makePartialEvent());
    expect(handler).toHaveBeenCalledTimes(1);

    unsub();

    collector.emit(makePartialEvent());
    expect(handler).toHaveBeenCalledTimes(1); // not called again
  });
});

// ── Buffer cap ───────────────────────────────────────────────

describe('SdkEventCollector — buffer cap', () => {
  it('drops oldest events when buffer exceeds MAX_BUFFER=10000', () => {
    const collector = new SdkEventCollector();

    // Fill buffer beyond max
    for (let i = 0; i < 10_002; i++) {
      collector.emit(makePartialEvent({ name: `ev-${i}` }));
    }

    const flushed = collector.flush();
    expect(flushed).toHaveLength(10_000);

    // Oldest events should have been dropped
    // First buffered event should be ev-2 (ev-0 and ev-1 dropped)
    expect((flushed[0] as any).name).toBe('ev-2');
  });
});

// ── flush ────────────────────────────────────────────────────

describe('SdkEventCollector — flush', () => {
  it('returns and clears buffer', () => {
    const collector = new SdkEventCollector();
    collector.emit(makePartialEvent());
    collector.emit(makePartialEvent());

    const first = collector.flush();
    expect(first).toHaveLength(2);

    const second = collector.flush();
    expect(second).toHaveLength(0);
  });
});

// ── getStats ─────────────────────────────────────────────────

describe('SdkEventCollector — getStats', () => {
  it('tracks total and byType counts', () => {
    const collector = new SdkEventCollector();

    collector.emit(makePartialEvent({ type: 'custom' }));
    collector.emit(makePartialEvent({ type: 'custom' }));
    collector.emit(makePartialEvent({ type: 'db-query' }));

    const stats = collector.getStats();
    expect(stats.total).toBe(3);
    expect(stats.byType['custom']).toBe(2);
    expect(stats.byType['db-query']).toBe(1);
  });

  it('returns a copy, not a reference', () => {
    const collector = new SdkEventCollector();
    collector.emit(makePartialEvent());

    const stats1 = collector.getStats();
    collector.emit(makePartialEvent());
    const stats2 = collector.getStats();

    expect(stats1.total).toBe(1);
    expect(stats2.total).toBe(2);
  });
});

// ── reset ────────────────────────────────────────────────────

describe('SdkEventCollector — reset', () => {
  it('clears buffer, handlers, stats, and sessionId', () => {
    const collector = new SdkEventCollector();
    collector.setSessionId('sess-abc');

    const handler = vi.fn();
    collector.onEvent(handler);
    collector.emit(makePartialEvent());

    collector.reset();

    // Buffer cleared
    expect(collector.flush()).toHaveLength(0);

    // Stats cleared
    const stats = collector.getStats();
    expect(stats.total).toBe(0);
    expect(stats.byType).toEqual({});

    // Handlers cleared — new emit should buffer, not call handler
    collector.emit(makePartialEvent());
    expect(handler).toHaveBeenCalledTimes(1); // only the first call before reset
    expect(collector.flush()).toHaveLength(1);

    // SessionId cleared — new events should have empty sessionId
    collector.emit(makePartialEvent());
    const flushed = collector.flush();
    expect(flushed[0].sessionId).toBe('');
  });
});

// ── setSessionId ─────────────────────────────────────────────

describe('SdkEventCollector — setSessionId', () => {
  it('sets id applied to emitted events', () => {
    const collector = new SdkEventCollector();
    collector.setSessionId('my-session');

    collector.emit(makePartialEvent());

    const flushed = collector.flush();
    expect(flushed[0].sessionId).toBe('my-session');
  });

  it('can be changed between emits', () => {
    const collector = new SdkEventCollector();
    collector.setSessionId('s1');
    collector.emit(makePartialEvent());

    collector.setSessionId('s2');
    collector.emit(makePartialEvent());

    const flushed = collector.flush();
    expect(flushed[0].sessionId).toBe('s1');
    expect(flushed[1].sessionId).toBe('s2');
  });
});

// ── Handler removal during iteration ─────────────────────────

describe('SdkEventCollector — handler removal during iteration', () => {
  it('does not break when handler unsubscribes during emit', () => {
    const collector = new SdkEventCollector();
    let unsub: () => void;

    const handler1 = vi.fn(() => {
      unsub(); // unsubscribe self during iteration
    });
    const handler2 = vi.fn();

    unsub = collector.onEvent(handler1);
    collector.onEvent(handler2);

    // Should not throw
    collector.emit(makePartialEvent());

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);

    // handler1 should be unsubscribed now
    collector.emit(makePartialEvent());
    expect(handler1).toHaveBeenCalledTimes(1); // not called again
    expect(handler2).toHaveBeenCalledTimes(2);
  });
});
