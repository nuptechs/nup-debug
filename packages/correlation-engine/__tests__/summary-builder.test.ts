import { describe, it, expect } from 'vitest';
import { buildGroupSummary } from '../src/summary-builder.js';
import type {
  ProbeEvent,
  BrowserEvent,
  BrowserErrorEvent,
  RequestEvent,
  ResponseEvent,
  LogEvent,
  SdkDbQueryEvent,
} from '@probe/core';

// ---- Helpers ----

let _seq = 0;
function makeEvent(partial: Partial<ProbeEvent> & { source: ProbeEvent['source'] }): ProbeEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: 1000 + _seq,
    ...partial,
  } as ProbeEvent;
}

function makeBrowserClick(url: string, ts: number): BrowserEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'browser',
    type: 'click',
    pageUrl: url,
  } as unknown as BrowserEvent;
}

function makeBrowserError(msg: string, ts: number): BrowserErrorEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'browser',
    type: 'error',
    errorType: 'uncaught',
    message: msg,
  } as unknown as BrowserErrorEvent;
}

function makeRequest(method: string, url: string, ts: number): RequestEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'network',
    type: 'request',
    requestId: `req-${_seq}`,
    method,
    url,
    headers: {},
  } as unknown as RequestEvent;
}

function makeResponse(statusCode: number, statusText: string, ts: number, duration = 100): ResponseEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'network',
    type: 'response',
    requestId: `req-${_seq}`,
    statusCode,
    statusText,
    headers: {},
    duration,
  } as unknown as ResponseEvent;
}

function makeLog(level: string, message: string, ts: number): LogEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'log',
    level,
    message,
    rawLine: message,
    logSource: { type: 'stdout', name: 'app' },
  } as unknown as LogEvent;
}

function makeDbQuery(query: string, duration: number, ts: number): SdkDbQueryEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'sdk',
    type: 'db-query',
    query,
    duration,
  } as unknown as SdkDbQueryEvent;
}

function makeScreenshot(ts: number): BrowserEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source: 'browser',
    type: 'screenshot',
  } as unknown as BrowserEvent;
}

// ---- Tests ----

describe('buildGroupSummary', () => {
  it('returns default empty summary for no events', () => {
    const summary = buildGroupSummary([]);
    expect(summary.trigger).toBeUndefined();
    expect(summary.httpMethod).toBeUndefined();
    expect(summary.httpUrl).toBeUndefined();
    expect(summary.httpStatus).toBeUndefined();
    expect(summary.totalDuration).toBeUndefined();
    expect(summary.hasScreenshot).toBe(false);
    expect(summary.hasError).toBe(false);
    expect(summary.errorMessages).toEqual([]);
    expect(summary.logCount).toBe(0);
    expect(summary.dbQueryCount).toBe(0);
    expect(summary.dbTotalDuration).toBe(0);
    expect(summary.entitiesInvolved).toEqual([]);
  });

  describe('trigger extraction', () => {
    it('extracts trigger from click event', () => {
      const summary = buildGroupSummary([makeBrowserClick('https://app.com/page', 1000)]);
      expect(summary.trigger).toBe('click:https://app.com/page');
    });

    it('uses first click/navigation as trigger', () => {
      const events = [
        makeBrowserClick('https://app.com/first', 1000),
        makeBrowserClick('https://app.com/second', 1100),
      ];
      const summary = buildGroupSummary(events);
      expect(summary.trigger).toBe('click:https://app.com/first');
    });
  });

  describe('HTTP info extraction', () => {
    it('extracts method and URL from first request', () => {
      const summary = buildGroupSummary([
        makeRequest('POST', 'https://api.com/users', 1000),
      ]);
      expect(summary.httpMethod).toBe('POST');
      expect(summary.httpUrl).toBe('https://api.com/users');
    });

    it('extracts status from first response', () => {
      const summary = buildGroupSummary([
        makeResponse(200, 'OK', 1100),
      ]);
      expect(summary.httpStatus).toBe(200);
    });

    it('marks error for 4xx/5xx responses', () => {
      const summary = buildGroupSummary([
        makeResponse(500, 'Internal Server Error', 1100),
      ]);
      expect(summary.hasError).toBe(true);
      expect(summary.errorMessages).toContain('HTTP 500 Internal Server Error');
    });
  });

  describe('screenshot detection', () => {
    it('detects screenshot events', () => {
      const summary = buildGroupSummary([makeScreenshot(1000)]);
      expect(summary.hasScreenshot).toBe(true);
    });

    it('false when no screenshots', () => {
      const summary = buildGroupSummary([makeLog('info', 'hi', 1000)]);
      expect(summary.hasScreenshot).toBe(false);
    });
  });

  describe('error detection', () => {
    it('detects browser error events', () => {
      const summary = buildGroupSummary([makeBrowserError('TypeError: null', 1000)]);
      expect(summary.hasError).toBe(true);
      expect(summary.errorMessages).toContain('TypeError: null');
    });

    it('detects error-level log events', () => {
      const summary = buildGroupSummary([makeLog('error', 'DB connection lost', 1000)]);
      expect(summary.hasError).toBe(true);
      expect(summary.errorMessages).toContain('DB connection lost');
    });

    it('detects fatal-level log events', () => {
      const summary = buildGroupSummary([makeLog('fatal', 'OOM', 1000)]);
      expect(summary.hasError).toBe(true);
    });

    it('does not flag info/warn logs as errors', () => {
      const summary = buildGroupSummary([
        makeLog('info', 'started', 1000),
        makeLog('warn', 'slow query', 1100),
      ]);
      expect(summary.hasError).toBe(false);
    });

    it('detects sdk request-end with error field', () => {
      const event = makeEvent({ source: 'sdk' });
      const sdkEnd = { ...event, type: 'request-end', error: 'timeout' };
      const summary = buildGroupSummary([sdkEnd as any]);
      expect(summary.hasError).toBe(true);
      expect(summary.errorMessages).toContain('timeout');
    });
  });

  describe('log counting', () => {
    it('counts all log events', () => {
      const summary = buildGroupSummary([
        makeLog('info', 'a', 1000),
        makeLog('debug', 'b', 1100),
        makeLog('error', 'c', 1200),
      ]);
      expect(summary.logCount).toBe(3);
    });
  });

  describe('DB query aggregation', () => {
    it('counts queries and sums duration', () => {
      const summary = buildGroupSummary([
        makeDbQuery('SELECT * FROM users', 50, 1000),
        makeDbQuery('INSERT INTO orders VALUES(...)', 30, 1100),
      ]);
      expect(summary.dbQueryCount).toBe(2);
      expect(summary.dbTotalDuration).toBe(80);
    });

    it('extracts entity names from SQL', () => {
      const summary = buildGroupSummary([
        makeDbQuery('SELECT * FROM users WHERE id = $1', 10, 1000),
        makeDbQuery('INSERT INTO orders VALUES($1)', 15, 1100),
        makeDbQuery('UPDATE products SET price = $1', 12, 1200),
        makeDbQuery('DELETE FROM sessions WHERE expired = true', 8, 1300),
      ]);
      expect(summary.entitiesInvolved).toContain('users');
      expect(summary.entitiesInvolved).toContain('orders');
      expect(summary.entitiesInvolved).toContain('products');
      expect(summary.entitiesInvolved).toContain('sessions');
    });

    it('deduplicates entity names', () => {
      const summary = buildGroupSummary([
        makeDbQuery('SELECT * FROM users WHERE id = $1', 10, 1000),
        makeDbQuery('SELECT * FROM users WHERE email = $1', 10, 1100),
      ]);
      expect(summary.entitiesInvolved).toEqual(['users']);
    });
  });

  describe('timing', () => {
    it('calculates totalDuration from earliest to latest event', () => {
      const summary = buildGroupSummary([
        makeLog('info', 'start', 1000),
        makeLog('info', 'mid', 1500),
        makeLog('info', 'end', 2000),
      ]);
      expect(summary.totalDuration).toBe(1000);
    });

    it('totalDuration is undefined for empty events', () => {
      const summary = buildGroupSummary([]);
      expect(summary.totalDuration).toBeUndefined();
    });

    it('totalDuration is 0 for single event', () => {
      const summary = buildGroupSummary([makeLog('info', 'only', 1000)]);
      expect(summary.totalDuration).toBe(0);
    });
  });

  describe('full flow — mixed event types', () => {
    it('aggregates a realistic request lifecycle', () => {
      const events = [
        makeBrowserClick('https://app.com/orders', 1000),
        makeRequest('GET', 'https://api.com/orders', 1010),
        makeDbQuery('SELECT * FROM orders WHERE user_id = $1', 45, 1020),
        makeLog('info', 'Fetching orders for user 42', 1025),
        makeResponse(200, 'OK', 1100),
        makeScreenshot(1110),
      ];

      const summary = buildGroupSummary(events);
      expect(summary.trigger).toBe('click:https://app.com/orders');
      expect(summary.httpMethod).toBe('GET');
      expect(summary.httpUrl).toBe('https://api.com/orders');
      expect(summary.httpStatus).toBe(200);
      expect(summary.totalDuration).toBe(110);
      expect(summary.hasScreenshot).toBe(true);
      expect(summary.hasError).toBe(false);
      expect(summary.logCount).toBe(1);
      expect(summary.dbQueryCount).toBe(1);
      expect(summary.entitiesInvolved).toContain('orders');
    });
  });
});
