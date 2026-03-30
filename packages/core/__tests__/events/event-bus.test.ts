// ============================================================
// EventBus — Comprehensive tests
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventBus } from '../../src/events/event-bus.js';
import type { ProbeEvent } from '../../src/types/events.js';

function makeEvent(overrides: Partial<ProbeEvent> = {}): ProbeEvent {
  return {
    id: 'evt-1',
    sessionId: 'sess-1',
    timestamp: Date.now(),
    source: 'browser',
    ...overrides,
  } as ProbeEvent;
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  describe('on / emit', () => {
    it('delivers events to matching subscribers', () => {
      const handler = vi.fn();
      bus.on('browser:click', handler);
      const event = makeEvent();
      bus.emit('browser:click', event);
      expect(handler).toHaveBeenCalledWith(event);
    });

    it('does not deliver events to non-matching subscribers', () => {
      const handler = vi.fn();
      bus.on('network:request', handler);
      bus.emit('browser:click', makeEvent());
      expect(handler).not.toHaveBeenCalled();
    });

    it('delivers to source-level subscribers', () => {
      const handler = vi.fn();
      bus.on('browser', handler);
      bus.emit('browser:click', makeEvent());
      expect(handler).toHaveBeenCalled();
    });

    it('supports multiple handlers for same event', () => {
      const h1 = vi.fn();
      const h2 = vi.fn();
      bus.on('test', h1);
      bus.on('test', h2);
      bus.emit('test', makeEvent());
      expect(h1).toHaveBeenCalled();
      expect(h2).toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('removes handler via returned unsubscribe function', () => {
      const handler = vi.fn();
      const unsub = bus.on('test', handler);
      unsub();
      bus.emit('test', makeEvent());
      expect(handler).not.toHaveBeenCalled();
    });

    it('removes handler via off method', () => {
      const handler = vi.fn();
      bus.on('test', handler);
      bus.off('test', handler);
      bus.emit('test', makeEvent());
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onAny', () => {
    it('receives all events', () => {
      const handler = vi.fn();
      bus.onAny(handler);
      bus.emit('a', makeEvent());
      bus.emit('b', makeEvent());
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('unsubscribes correctly', () => {
      const handler = vi.fn();
      const unsub = bus.onAny(handler);
      unsub();
      bus.emit('a', makeEvent());
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('error isolation', () => {
    it('does not propagate handler errors to other handlers', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('boom');
      });
      const goodHandler = vi.fn();
      bus.on('test', errorHandler);
      bus.on('test', goodHandler);

      // Should not throw
      bus.emit('test', makeEvent());
      expect(goodHandler).toHaveBeenCalled();
    });
  });

  describe('emitCount / handlerCount', () => {
    it('tracks emit count', () => {
      expect(bus.emitCount).toBe(0);
      bus.emit('a', makeEvent());
      bus.emit('b', makeEvent());
      expect(bus.emitCount).toBe(2);
    });

    it('tracks handler count', () => {
      expect(bus.handlerCount).toBe(0);
      bus.on('a', () => {});
      bus.onAny(() => {});
      expect(bus.handlerCount).toBe(2);
    });
  });

  describe('clear', () => {
    it('removes all handlers', () => {
      const handler = vi.fn();
      bus.on('test', handler);
      bus.onAny(handler);
      bus.clear();
      bus.emit('test', makeEvent());
      expect(handler).not.toHaveBeenCalled();
      expect(bus.handlerCount).toBe(0);
    });
  });
});
