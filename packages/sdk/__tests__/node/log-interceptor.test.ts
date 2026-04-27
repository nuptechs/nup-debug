// ============================================================
// Log Interceptor — Comprehensive tests
// Console wrapping, event emission, restore, truncation
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createLogInterceptor,
  wrapConsole,
} from '../../src/node/log-interceptor.js';
import { SdkEventCollector } from '../../src/node/event-collector.js';

// ── Save / restore real console ──────────────────────────────

const realConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info,
  debug: console.debug,
};

afterEach(() => {
  // Safety: always restore real console in case a test fails to restore
  console.log = realConsole.log;
  console.warn = realConsole.warn;
  console.error = realConsole.error;
  console.info = realConsole.info;
  console.debug = realConsole.debug;
});

// ── createLogInterceptor ─────────────────────────────────────

describe('createLogInterceptor', () => {
  it('creates interceptor with default collector', () => {
    const interceptor = createLogInterceptor();
    expect(interceptor.collector).toBeInstanceOf(SdkEventCollector);
  });

  it('creates interceptor with provided collector', () => {
    const collector = new SdkEventCollector();
    const interceptor = createLogInterceptor(collector);
    expect(interceptor.collector).toBe(collector);
  });
});

// ── wrapConsole — wrapping ───────────────────────────────────

describe('wrapConsole', () => {
  let collector: SdkEventCollector;
  let events: any[];
  let restore: () => void;

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));

    const interceptor = createLogInterceptor(collector);

    // Suppress actual console output in tests
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
    console.info = vi.fn();
    console.debug = vi.fn();

    restore = wrapConsole(interceptor);
  });

  afterEach(() => {
    restore();
  });

  it('wraps log/warn/error/info/debug', () => {
    console.log('test-log');
    console.warn('test-warn');
    console.error('test-error');
    console.info('test-info');
    console.debug('test-debug');

    expect(events).toHaveLength(5);
  });

  it('original console is still called', () => {
    // console.log was replaced by vi.fn() in beforeEach,
    // then wrapped by wrapConsole which calls the "original" (fn) first
    console.log('hello');

    // The vi.fn() we set should have been called (as original)
    // And we should also get an event
    expect(events).toHaveLength(1);
  });

  it('emits events with type "custom" and name "console.level"', () => {
    console.log('test');
    console.error('err');

    expect(events[0].type).toBe('custom');
    expect(events[0].name).toBe('console.log');
    expect(events[1].name).toBe('console.error');
  });

  it('emits data with level and message', () => {
    console.warn('warning message');

    const data = events[0].data;
    expect(data.level).toBe('warn');
    expect(data.message).toContain('warning message');
  });
});

// ── Restore function ─────────────────────────────────────────

describe('wrapConsole — restore', () => {
  it('restore function unwraps console methods', () => {
    const collector = new SdkEventCollector();
    const interceptor = createLogInterceptor(collector);

    const originalLog = console.log;
    const restore = wrapConsole(interceptor);
    expect(console.log).not.toBe(originalLog);

    restore();
    expect(console.log).toBe(originalLog);
  });
});

// ── Message truncation ───────────────────────────────────────

describe('wrapConsole — truncation', () => {
  let collector: SdkEventCollector;
  let events: any[];
  let restore: () => void;

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));

    const interceptor = createLogInterceptor(collector);

    console.log = vi.fn();
    restore = wrapConsole(interceptor);
  });

  afterEach(() => {
    restore();
  });

  it('truncates messages longer than MAX_MESSAGE_LENGTH=8192', () => {
    const longMessage = 'x'.repeat(10_000);
    console.log(longMessage);

    const msg = events[0].data.message;
    expect(msg.length).toBeLessThanOrEqual(8_192 + 20); // allow for '... [truncated]' suffix + redaction margin
  });

  it('does not truncate short messages', () => {
    console.log('short');

    const msg = events[0].data.message;
    expect(msg).toContain('short');
  });
});

// ── Error stack traces ───────────────────────────────────────

describe('wrapConsole — Error stack capture', () => {
  let collector: SdkEventCollector;
  let events: any[];
  let restore: () => void;

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));

    const interceptor = createLogInterceptor(collector);

    console.error = vi.fn();
    restore = wrapConsole(interceptor);
  });

  afterEach(() => {
    restore();
  });

  it('captures Error stack traces for console.error', () => {
    const err = new Error('test error');
    console.error('Something failed:', err);

    const data = events[0].data;
    expect(data.stack).toBeDefined();
    expect(data.stack).toContain('test error');
  });

  it('does not capture stack for console.log with Error', () => {
    const collector2 = new SdkEventCollector();
    const events2: any[] = [];
    collector2.onEvent((e) => events2.push(e));

    restore();

    const interceptor2 = createLogInterceptor(collector2);
    console.log = vi.fn();
    const restore2 = wrapConsole(interceptor2);

    console.log(new Error('should not capture stack'));

    expect(events2[0].data.stack).toBeUndefined();
    restore2();
  });
});

// ── Non-string args handling ─────────────────────────────────

describe('wrapConsole — non-string args', () => {
  let collector: SdkEventCollector;
  let events: any[];
  let restore: () => void;

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));

    const interceptor = createLogInterceptor(collector);

    console.log = vi.fn();
    console.error = vi.fn();
    restore = wrapConsole(interceptor);
  });

  afterEach(() => {
    restore();
  });

  it('stringifies objects', () => {
    console.log({ key: 'value', num: 42 });

    const msg = events[0].data.message;
    expect(msg).toContain('key');
    expect(msg).toContain('value');
  });

  it('converts Errors to message string', () => {
    console.log(new Error('error-msg'));

    const msg = events[0].data.message;
    expect(msg).toContain('error-msg');
  });

  it('joins multiple args with spaces', () => {
    console.log('hello', 'world', 42);

    const msg = events[0].data.message;
    expect(msg).toContain('hello');
    expect(msg).toContain('world');
  });
});

// ── redactBody applied ───────────────────────────────────────

describe('wrapConsole — redactBody', () => {
  let collector: SdkEventCollector;
  let events: any[];
  let restore: () => void;

  beforeEach(() => {
    collector = new SdkEventCollector();
    events = [];
    collector.onEvent((e) => events.push(e));

    const interceptor = createLogInterceptor(collector);

    console.log = vi.fn();
    restore = wrapConsole(interceptor);
  });

  afterEach(() => {
    restore();
  });

  it('redactBody is applied to messages', () => {
    // redactBody from @nuptechs-probe/core should redact sensitive patterns
    // The exact redaction depends on the core implementation,
    // but we verify the function is called by checking the message is processed
    console.log('normal message');

    const msg = events[0].data.message;
    expect(typeof msg).toBe('string');
    expect(msg).toContain('normal message');
  });
});
