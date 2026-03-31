// ============================================================
// EventBus Handler Caps — Tests for per-event and wildcard limits
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/events/event-bus.js';
import type { ProbeEvent } from '../../src/types/events.js';

const MAX_HANDLERS_PER_EVENT = 100;
const MAX_WILDCARD_HANDLERS = 50;

function makeEvent(overrides: Partial<ProbeEvent> = {}): ProbeEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    source: 'browser',
    ...overrides,
  } as ProbeEvent;
}

describe('EventBus handler caps', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  // ── Per-event handler cap ──

  describe(`per-event handler cap (${MAX_HANDLERS_PER_EVENT})`, () => {
    it(`allows up to ${MAX_HANDLERS_PER_EVENT} handlers for same event type`, () => {
      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        const unsub = bus.on('test:event', vi.fn());
        expect(typeof unsub).toBe('function');
      }
      expect(bus.handlerCount).toBe(MAX_HANDLERS_PER_EVENT);
    });

    it(`rejects the ${MAX_HANDLERS_PER_EVENT + 1}th handler for same event type`, () => {
      const errorHandler = vi.fn();
      bus.setErrorHandler(errorHandler);

      // Fill to max
      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        bus.on('test:event', vi.fn());
      }

      // 101st should be rejected
      const handler101 = vi.fn();
      bus.on('test:event', handler101);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.stringContaining('Handler limit reached'),
        expect.any(Error),
      );
    });

    it('rejected handler does not receive events', () => {
      bus.setErrorHandler(() => {}); // suppress error logging

      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        bus.on('test:event', vi.fn());
      }

      const rejectedHandler = vi.fn();
      bus.on('test:event', rejectedHandler);

      bus.emit('test:event', makeEvent());
      expect(rejectedHandler).not.toHaveBeenCalled();
    });

    it('rejected handler returns no-op unsubscribe', () => {
      bus.setErrorHandler(() => {});

      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        bus.on('test:event', vi.fn());
      }

      const unsub = bus.on('test:event', vi.fn());
      // Should not throw
      expect(() => unsub()).not.toThrow();
    });

    it('cap is per event type — different types have independent limits', () => {
      bus.setErrorHandler(() => {});

      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        bus.on('type-a', vi.fn());
      }

      // type-b should still accept handlers
      const handler = vi.fn();
      bus.on('type-b', handler);
      bus.emit('type-b', makeEvent());
      expect(handler).toHaveBeenCalled();
    });

    it('can add handler after removing one from a maxed-out event type', () => {
      bus.setErrorHandler(() => {});

      const handlers: Array<() => void> = [];
      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        handlers.push(bus.on('test:event', vi.fn()));
      }

      // Remove one
      handlers[0]();

      // Now should accept a new one
      const newHandler = vi.fn();
      bus.on('test:event', newHandler);
      bus.emit('test:event', makeEvent());
      expect(newHandler).toHaveBeenCalled();
    });
  });

  // ── Wildcard handler cap ──

  describe(`wildcard handler cap (${MAX_WILDCARD_HANDLERS})`, () => {
    it(`allows up to ${MAX_WILDCARD_HANDLERS} wildcard handlers`, () => {
      for (let i = 0; i < MAX_WILDCARD_HANDLERS; i++) {
        const unsub = bus.onAny(vi.fn());
        expect(typeof unsub).toBe('function');
      }
      expect(bus.handlerCount).toBe(MAX_WILDCARD_HANDLERS);
    });

    it(`rejects the ${MAX_WILDCARD_HANDLERS + 1}th wildcard handler`, () => {
      const errorHandler = vi.fn();
      bus.setErrorHandler(errorHandler);

      for (let i = 0; i < MAX_WILDCARD_HANDLERS; i++) {
        bus.onAny(vi.fn());
      }

      // 51st should be rejected
      bus.onAny(vi.fn());

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(
        expect.stringContaining('Wildcard handler limit reached'),
        expect.any(Error),
      );
    });

    it('rejected wildcard handler does not receive events', () => {
      bus.setErrorHandler(() => {});

      for (let i = 0; i < MAX_WILDCARD_HANDLERS; i++) {
        bus.onAny(vi.fn());
      }

      const rejectedHandler = vi.fn();
      bus.onAny(rejectedHandler);

      bus.emit('test', makeEvent());
      expect(rejectedHandler).not.toHaveBeenCalled();
    });

    it('wildcard cap is independent from per-event cap', () => {
      bus.setErrorHandler(() => {});

      // Fill wildcard to max
      for (let i = 0; i < MAX_WILDCARD_HANDLERS; i++) {
        bus.onAny(vi.fn());
      }

      // Per-event handlers should still work
      const handler = vi.fn();
      bus.on('test', handler);
      bus.emit('test', makeEvent());
      expect(handler).toHaveBeenCalled();
    });

    it('can add wildcard handler after removing one from maxed-out set', () => {
      bus.setErrorHandler(() => {});

      const unsubs: Array<() => void> = [];
      for (let i = 0; i < MAX_WILDCARD_HANDLERS; i++) {
        unsubs.push(bus.onAny(vi.fn()));
      }

      // Remove one
      unsubs[0]();

      // Should accept a new one
      const newHandler = vi.fn();
      bus.onAny(newHandler);
      bus.emit('test', makeEvent());
      expect(newHandler).toHaveBeenCalled();
    });
  });

  // ── Combined scenarios ──

  describe('combined cap scenarios', () => {
    it('handler count reflects both per-event and wildcard handlers', () => {
      bus.on('a', vi.fn());
      bus.on('b', vi.fn());
      bus.onAny(vi.fn());
      expect(bus.handlerCount).toBe(3);
    });

    it('clear resets all counts, allowing re-registration up to caps', () => {
      bus.setErrorHandler(() => {});

      for (let i = 0; i < MAX_HANDLERS_PER_EVENT; i++) {
        bus.on('test:event', vi.fn());
      }
      for (let i = 0; i < MAX_WILDCARD_HANDLERS; i++) {
        bus.onAny(vi.fn());
      }

      bus.clear();

      // Should accept handlers again
      const handler = vi.fn();
      bus.on('test:event', handler);
      bus.onAny(handler);
      bus.emit('test:event', makeEvent());
      expect(handler).toHaveBeenCalledTimes(2); // once from on, once from onAny
    });
  });
});
