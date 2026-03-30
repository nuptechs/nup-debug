// ============================================================
// Circuit Breaker — Comprehensive tests
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CircuitBreaker,
  CircuitState,
  CircuitOpenError,
} from '../../src/shared/circuit-breaker.js';

describe('CircuitBreaker', () => {
  describe('initial state', () => {
    it('starts in CLOSED state', () => {
      const cb = new CircuitBreaker();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('reports zero stats initially', () => {
      const cb = new CircuitBreaker();
      expect(cb.getStats()).toEqual({
        failures: 0,
        successes: 0,
        state: CircuitState.CLOSED,
        lastFailure: undefined,
      });
    });
  });

  describe('CLOSED state', () => {
    it('passes through successful calls', async () => {
      const cb = new CircuitBreaker();
      const result = await cb.execute(async () => 42);
      expect(result).toBe(42);
      expect(cb.getStats().successes).toBe(1);
    });

    it('counts failures and passes through errors', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 5 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow('fail');
      expect(cb.getStats().failures).toBe(1);
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });

    it('transitions to OPEN after reaching failure threshold', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const failFn = async () => { throw new Error('fail'); };

      for (let i = 0; i < 3; i++) {
        await expect(cb.execute(failFn)).rejects.toThrow();
      }
      expect(cb.getState()).toBe(CircuitState.OPEN);
    });

    it('resets failure count on success', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      const failFn = async () => { throw new Error('fail'); };

      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();
      // Success resets consecutive count
      await cb.execute(async () => 'ok');
      await expect(cb.execute(failFn)).rejects.toThrow();
      await expect(cb.execute(failFn)).rejects.toThrow();
      // Still closed because only 2 consecutive failures
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('OPEN state', () => {
    it('rejects immediately with CircuitOpenError', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60000 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

      await expect(cb.execute(async () => 'ok')).rejects.toThrow(CircuitOpenError);
    });

    it('does not call the wrapped function', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 60000 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

      const fn = vi.fn(async () => 'ok');
      await expect(cb.execute(fn)).rejects.toThrow(CircuitOpenError);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('HALF_OPEN state', () => {
    it('transitions from OPEN after resetTimeout', async () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 5000 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(cb.getState()).toBe(CircuitState.OPEN);

      vi.advanceTimersByTime(5001);
      expect(cb.getState()).toBe(CircuitState.HALF_OPEN);
      vi.useRealTimers();
    });

    it('transitions to CLOSED on success', async () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

      vi.advanceTimersByTime(1001);
      const result = await cb.execute(async () => 'recovered');
      expect(result).toBe('recovered');
      expect(cb.getState()).toBe(CircuitState.CLOSED);
      vi.useRealTimers();
    });

    it('transitions back to OPEN on failure', async () => {
      vi.useFakeTimers();
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 1000 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();

      vi.advanceTimersByTime(1001);
      await expect(cb.execute(async () => { throw new Error('still broken'); })).rejects.toThrow('still broken');
      expect(cb.getState()).toBe(CircuitState.OPEN);
      vi.useRealTimers();
    });
  });

  describe('reset', () => {
    it('resets circuit to CLOSED state', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1 });
      await expect(cb.execute(async () => { throw new Error('fail'); })).rejects.toThrow();
      expect(cb.getState()).toBe(CircuitState.OPEN);
      cb.reset();
      expect(cb.getState()).toBe(CircuitState.CLOSED);
    });
  });
});
