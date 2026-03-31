// ============================================================
// Console Interceptor — Truncation + redaction tests
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installConsoleInterceptor } from '../../src/browser/console-interceptor.js';

const MAX_MESSAGE_LENGTH = 8_192;

describe('installConsoleInterceptor', () => {
  // Save original console methods
  const originals = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    info: console.info,
    debug: console.debug,
  };

  let restore: (() => void) | null = null;

  afterEach(() => {
    // Restore console from the interceptor if active
    if (restore) {
      restore();
      restore = null;
    }
    // Ensure clean console even if restore failed
    console.log = originals.log;
    console.warn = originals.warn;
    console.error = originals.error;
    console.info = originals.info;
    console.debug = originals.debug;
  });

  it('captures console.log as sdk event', () => {
    const events: any[] = [];
    restore = installConsoleInterceptor((e) => events.push(e));

    console.log('hello world');

    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('console.log');
    expect(events[0].data.level).toBe('log');
    expect(events[0].data.message).toBe('hello world');
  });

  it('captures all console levels', () => {
    const events: any[] = [];
    restore = installConsoleInterceptor((e) => events.push(e));

    console.log('l');
    console.warn('w');
    console.error('e');
    console.info('i');
    console.debug('d');

    expect(events).toHaveLength(5);
    expect(events.map(e => e.data.level)).toEqual(['log', 'warn', 'error', 'info', 'debug']);
  });

  it('preserves original console output', () => {
    const spy = vi.fn();
    console.log = spy;

    const events: any[] = [];
    restore = installConsoleInterceptor((e) => events.push(e));
    console.log('test');

    // The original (spy) should have been called
    expect(spy).toHaveBeenCalledWith('test');
  });

  // ── Truncation tests ──

  describe('message truncation', () => {
    it('truncates a single string argument exceeding MAX_MESSAGE_LENGTH', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      const longStr = 'x'.repeat(MAX_MESSAGE_LENGTH + 500);
      console.log(longStr);

      expect(events).toHaveLength(1);
      const msg = events[0].data.message as string;
      // Total message should not exceed MAX_MESSAGE_LENGTH + truncation marker
      expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 20);
    });

    it('truncates JSON-serialized objects exceeding MAX_MESSAGE_LENGTH', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      const bigObj: Record<string, string> = {};
      for (let i = 0; i < 2000; i++) {
        bigObj[`key_${i}`] = 'a'.repeat(10);
      }
      console.log(bigObj);

      expect(events).toHaveLength(1);
      const msg = events[0].data.message as string;
      expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 20);
    });

    it('truncates combined multi-arg message', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      // 3 args each near max length — combined message should still be capped
      const arg = 'z'.repeat(MAX_MESSAGE_LENGTH);
      console.log(arg, arg, arg);

      expect(events).toHaveLength(1);
      const msg = events[0].data.message as string;
      // The final message after concat + truncation should be capped
      expect(msg.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH + 20);
    });

    it('does not truncate short messages', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      console.log('short message');

      expect(events).toHaveLength(1);
      expect(events[0].data.message).toBe('short message');
    });

    it('per-arg truncation happens before join', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      const longArg = 'q'.repeat(MAX_MESSAGE_LENGTH + 100);
      console.log(longArg);

      const msg = events[0].data.message as string;
      // The message contains the truncated arg, which is MAX_MESSAGE_LENGTH long
      // Then overall truncation may add "... [truncated]" 
      expect(msg).not.toContain('q'.repeat(MAX_MESSAGE_LENGTH + 100));
    });
  });

  // ── Redaction integration ──

  describe('redactBody integration', () => {
    it('redacts JWT tokens in console output', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.abc123signature';
      console.log('token:', jwt);

      expect(events).toHaveLength(1);
      const msg = events[0].data.message as string;
      expect(msg).not.toContain('eyJhbGciOiJIUzI1NiJ9');
      expect(msg).toContain('[REDACTED]');
    });

    it('redacts credit card numbers', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      console.log('Card: 4111-1111-1111-1111');

      const msg = events[0].data.message as string;
      expect(msg).not.toContain('4111-1111-1111-1111');
      expect(msg).toContain('[REDACTED]');
    });

    it('redacts SSN patterns', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      console.log('SSN is 123-45-6789');

      const msg = events[0].data.message as string;
      expect(msg).not.toContain('123-45-6789');
      expect(msg).toContain('[REDACTED]');
    });

    it('redacts Bearer tokens', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      console.log('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.token');

      const msg = events[0].data.message as string;
      expect(msg).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.token');
      expect(msg).toContain('[REDACTED]');
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('extracts Error stack from console.error arguments', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      const err = new Error('test error');
      console.error('Failed:', err);

      expect(events).toHaveLength(1);
      expect(events[0].data.stack).toBeDefined();
      expect(events[0].data.stack).toContain('Error: test error');
    });

    it('formats Error as name: message in the message string', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      const err = new TypeError('bad argument');
      console.log(err);

      expect(events).toHaveLength(1);
      expect(events[0].data.message).toContain('TypeError: bad argument');
    });
  });

  // ── Restore function ──

  describe('restore function', () => {
    it('restores original console methods', () => {
      const origLog = console.log;
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));

      // Console should be wrapped now
      expect(console.log).not.toBe(origLog);

      // Restore
      restore();
      restore = null; // prevent afterEach from double-restoring

      expect(console.log).toBe(origLog);
    });

    it('stops emitting events after restore', () => {
      const events: any[] = [];
      restore = installConsoleInterceptor((e) => events.push(e));
      console.log('before');
      expect(events).toHaveLength(1);

      restore();
      restore = null;

      console.log('after');
      expect(events).toHaveLength(1); // no new event
    });
  });
});
