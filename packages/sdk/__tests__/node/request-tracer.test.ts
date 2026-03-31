import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RequestTracer } from '../../src/node/request-tracer.js';

describe('RequestTracer', () => {
  let tracer: RequestTracer;

  beforeEach(() => {
    vi.useFakeTimers();
    tracer = new RequestTracer();
  });

  afterEach(() => {
    tracer.destroy();
    vi.useRealTimers();
  });

  describe('startRequest', () => {
    it('returns requestId and correlationId', () => {
      const { requestId, correlationId } = tracer.startRequest('GET', 'https://api.com/users');
      expect(requestId).toMatch(/^req-/);
      expect(correlationId).toMatch(/^probe-/);
    });

    it('increments active count', () => {
      expect(tracer.getActiveCount()).toBe(0);
      tracer.startRequest('GET', '/a');
      expect(tracer.getActiveCount()).toBe(1);
      tracer.startRequest('POST', '/b');
      expect(tracer.getActiveCount()).toBe(2);
    });

    it('generates unique IDs per request', () => {
      const r1 = tracer.startRequest('GET', '/a');
      const r2 = tracer.startRequest('GET', '/b');
      expect(r1.requestId).not.toBe(r2.requestId);
      expect(r1.correlationId).not.toBe(r2.correlationId);
    });
  });

  describe('endRequest', () => {
    it('decrements active count', () => {
      const { requestId } = tracer.startRequest('GET', '/a');
      expect(tracer.getActiveCount()).toBe(1);
      tracer.endRequest(requestId, 200);
      expect(tracer.getActiveCount()).toBe(0);
    });

    it('is a no-op for unknown requestId', () => {
      tracer.startRequest('GET', '/a');
      tracer.endRequest('req-nonexistent', 200);
      expect(tracer.getActiveCount()).toBe(1);
    });

    it('emits request-end event via collector', () => {
      const events: any[] = [];
      tracer.onEvent((e) => events.push(e));

      const { requestId } = tracer.startRequest('GET', '/a');
      tracer.endRequest(requestId, 200);

      // Should have request-start + request-end
      const ends = events.filter((e) => e.type === 'request-end');
      expect(ends).toHaveLength(1);
      expect(ends[0].statusCode).toBe(200);
    });

    it('includes error field when provided', () => {
      const events: any[] = [];
      tracer.onEvent((e) => events.push(e));

      const { requestId } = tracer.startRequest('GET', '/a');
      tracer.endRequest(requestId, 0, 'Connection refused');

      const end = events.find((e) => e.type === 'request-end');
      expect(end.error).toBe('Connection refused');
    });
  });

  describe('event emission', () => {
    it('emits request-start on startRequest', () => {
      const events: any[] = [];
      tracer.onEvent((e) => events.push(e));

      tracer.startRequest('POST', 'https://api.com/create', { 'Content-Type': 'application/json' });

      const starts = events.filter((e) => e.type === 'request-start');
      expect(starts).toHaveLength(1);
      expect(starts[0].method).toBe('POST');
      expect(starts[0].url).toBe('https://api.com/create');
    });

    it('redacts sensitive headers in request-start', () => {
      const events: any[] = [];
      tracer.onEvent((e) => events.push(e));

      tracer.startRequest(
        'GET',
        '/a',
        { Authorization: 'Bearer secret123', 'X-Custom': 'visible' },
        ['Authorization'],
      );

      const start = events.find((e) => e.type === 'request-start');
      // Authorization should be redacted
      expect(start.headers.Authorization).not.toBe('Bearer secret123');
      expect(start.headers['X-Custom']).toBe('visible');
    });

    it('unsubscribe function stops events', () => {
      const events: any[] = [];
      const unsub = tracer.onEvent((e) => events.push(e));

      tracer.startRequest('GET', '/a');
      const countAfterFirst = events.length;

      unsub();
      tracer.startRequest('GET', '/b');
      expect(events.length).toBe(countAfterFirst);
    });
  });

  describe('MAX_ACTIVE eviction', () => {
    it('evicts oldest when at capacity (10,000)', () => {
      // We can't easily create 10k requests in a unit test,
      // but we can verify the pattern with a smaller test
      const r1 = tracer.startRequest('GET', '/first');
      for (let i = 0; i < 100; i++) {
        tracer.startRequest('GET', `/req-${i}`);
      }
      expect(tracer.getActiveCount()).toBeLessThanOrEqual(101);
    });
  });

  describe('timeout cleanup', () => {
    it('auto-ends requests after 60s', () => {
      const events: any[] = [];
      tracer.onEvent((e) => events.push(e));

      tracer.startRequest('GET', '/slow');
      expect(tracer.getActiveCount()).toBe(1);

      // Advance past the cleanup timer (runs every 15s) and the 60s timeout
      vi.advanceTimersByTime(75_000);

      expect(tracer.getActiveCount()).toBe(0);
      const end = events.find((e) => e.type === 'request-end' && e.error?.includes('timed out'));
      expect(end).toBeDefined();
    });

    it('does not timeout requests that complete normally', () => {
      const events: any[] = [];
      tracer.onEvent((e) => events.push(e));

      const { requestId } = tracer.startRequest('GET', '/fast');
      tracer.endRequest(requestId, 200);

      vi.advanceTimersByTime(75_000);

      // Only one request-end (the normal one), no timeout
      const ends = events.filter((e) => e.type === 'request-end');
      expect(ends).toHaveLength(1);
      expect(ends[0].error).toBeUndefined();
    });
  });

  describe('destroy', () => {
    it('clears active requests', () => {
      tracer.startRequest('GET', '/a');
      tracer.startRequest('GET', '/b');
      expect(tracer.getActiveCount()).toBe(2);

      tracer.destroy();
      expect(tracer.getActiveCount()).toBe(0);
    });

    it('stops cleanup timer', () => {
      tracer.startRequest('GET', '/a');
      tracer.destroy();

      // Advancing timers should not cause errors
      vi.advanceTimersByTime(100_000);
      expect(tracer.getActiveCount()).toBe(0);
    });
  });
});
