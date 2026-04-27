import { describe, it, expect } from 'vitest';
import { buildTimeline } from '../../src/timeline/timeline-builder.js';
import type {
  ProbeEvent,
  CorrelationGroup,
  ResponseEvent,
  LogEvent,
  BrowserEvent,
} from '@nuptechs-probe/core';

// ---- Helpers ----

let _seq = 0;
function evt(source: ProbeEvent['source'], ts: number, extra: Record<string, unknown> = {}): ProbeEvent {
  return {
    id: `evt-${++_seq}`,
    sessionId: 'sess-1',
    timestamp: ts,
    source,
    ...extra,
  } as ProbeEvent;
}

function makeGroup(id: string, events: ProbeEvent[]): CorrelationGroup {
  return {
    id,
    sessionId: 'sess-1',
    correlationId: `corr-${id}`,
    createdAt: events[0]?.timestamp ?? 0,
    events,
    summary: {
      hasScreenshot: false,
      hasError: false,
      errorMessages: [],
      logCount: 0,
      dbQueryCount: 0,
      dbTotalDuration: 0,
      entitiesInvolved: [],
    },
  };
}

describe('buildTimeline', () => {
  describe('basic structure', () => {
    it('returns a Timeline with correct sessionId', () => {
      const tl = buildTimeline([], [], 'sess-42');
      expect(tl.sessionId).toBe('sess-42');
    });

    it('returns empty entries for empty events', () => {
      const tl = buildTimeline([], [], 'sess-1');
      expect(tl.entries).toEqual([]);
      expect(tl.duration).toBe(0);
      expect(tl.startTime).toBe(0);
      expect(tl.endTime).toBe(0);
    });
  });

  describe('sorting', () => {
    it('sorts events chronologically', () => {
      const events = [
        evt('log', 3000),
        evt('browser', 1000),
        evt('network', 2000),
      ];
      const tl = buildTimeline([], events, 'sess-1');
      expect(tl.entries.map((e) => e.event.source)).toEqual([
        'browser',
        'network',
        'log',
      ]);
    });

    it('uses id as tiebreaker for equal timestamps', () => {
      _seq = 0;
      const e1 = evt('log', 1000); // evt-1
      const e2 = evt('log', 1000); // evt-2
      const tl = buildTimeline([], [e2, e1], 'sess-1');
      expect(tl.entries[0]!.event.id).toBe('evt-1');
      expect(tl.entries[1]!.event.id).toBe('evt-2');
    });
  });

  describe('depth assignment', () => {
    it('assigns depth 0 to browser events', () => {
      const tl = buildTimeline([], [evt('browser', 1000)], 'sess-1');
      expect(tl.entries[0]!.depth).toBe(0);
    });

    it('assigns depth 1 to network events', () => {
      const tl = buildTimeline([], [evt('network', 1000)], 'sess-1');
      expect(tl.entries[0]!.depth).toBe(1);
    });

    it('assigns depth 2 to sdk events', () => {
      const tl = buildTimeline([], [evt('sdk', 1000)], 'sess-1');
      expect(tl.entries[0]!.depth).toBe(2);
    });

    it('assigns depth 3 to log events', () => {
      const tl = buildTimeline([], [evt('log', 1000)], 'sess-1');
      expect(tl.entries[0]!.depth).toBe(3);
    });

    it('assigns depth 0 to correlation events', () => {
      const tl = buildTimeline([], [evt('correlation', 1000)], 'sess-1');
      expect(tl.entries[0]!.depth).toBe(0);
    });
  });

  describe('group association', () => {
    it('links events to their correlation group', () => {
      const e1 = evt('browser', 1000);
      const e2 = evt('network', 2000);
      const e3 = evt('log', 3000);
      const group = makeGroup('g1', [e1, e2]);

      const tl = buildTimeline([group], [e1, e2, e3], 'sess-1');
      expect(tl.entries[0]!.groupId).toBe('g1');
      expect(tl.entries[1]!.groupId).toBe('g1');
      expect(tl.entries[2]!.groupId).toBeUndefined();
    });

    it('handles multiple groups', () => {
      const e1 = evt('browser', 1000);
      const e2 = evt('network', 2000);
      const e3 = evt('sdk', 3000);
      const g1 = makeGroup('g1', [e1]);
      const g2 = makeGroup('g2', [e2, e3]);

      const tl = buildTimeline([g1, g2], [e1, e2, e3], 'sess-1');
      expect(tl.entries[0]!.groupId).toBe('g1');
      expect(tl.entries[1]!.groupId).toBe('g2');
      expect(tl.entries[2]!.groupId).toBe('g2');
    });
  });

  describe('duration / timing', () => {
    it('calculates duration from first to last event', () => {
      const events = [
        evt('browser', 1000),
        evt('log', 3000),
      ];
      const tl = buildTimeline([], events, 'sess-1');
      expect(tl.startTime).toBe(1000);
      expect(tl.endTime).toBe(3000);
      expect(tl.duration).toBe(2000);
    });

    it('single event → duration 0', () => {
      const tl = buildTimeline([], [evt('log', 5000)], 'sess-1');
      expect(tl.duration).toBe(0);
    });
  });

  describe('stats computation', () => {
    it('counts events by source', () => {
      const events = [
        evt('browser', 1000),
        evt('browser', 1100),
        evt('network', 2000),
        evt('log', 3000),
        evt('sdk', 4000),
      ];
      const tl = buildTimeline([], events, 'sess-1');
      expect(tl.stats.totalEvents).toBe(5);
      expect(tl.stats.bySource.browser).toBe(2);
      expect(tl.stats.bySource.network).toBe(1);
      expect(tl.stats.bySource.log).toBe(1);
      expect(tl.stats.bySource.sdk).toBe(1);
    });

    it('counts correlation groups', () => {
      const e1 = evt('browser', 1000);
      const e2 = evt('network', 2000);
      const g1 = makeGroup('g1', [e1]);
      const g2 = makeGroup('g2', [e2]);

      const tl = buildTimeline([g1, g2], [e1, e2], 'sess-1');
      expect(tl.stats.correlationGroups).toBe(2);
    });

    it('counts browser error events', () => {
      const errorEvt = evt('browser', 1000, { type: 'error' }) as BrowserEvent;
      const tl = buildTimeline([], [errorEvt], 'sess-1');
      expect(tl.stats.errors).toBe(1);
    });

    it('counts error/fatal log events', () => {
      const errorLog = evt('log', 1000, { level: 'error' });
      const fatalLog = evt('log', 1100, { level: 'fatal' });
      const infoLog = evt('log', 1200, { level: 'info' });
      const tl = buildTimeline([], [errorLog, fatalLog, infoLog], 'sess-1');
      expect(tl.stats.errors).toBe(2);
    });

    it('counts 4xx/5xx responses as errors', () => {
      const resp = {
        ...evt('network', 1000),
        type: 'response',
        statusCode: 500,
        statusText: 'ISE',
        headers: {},
        duration: 100,
      } as unknown as ResponseEvent;
      const tl = buildTimeline([], [resp], 'sess-1');
      expect(tl.stats.errors).toBe(1);
    });

    it('calculates average response time', () => {
      const r1 = {
        ...evt('network', 1000),
        type: 'response',
        statusCode: 200,
        statusText: 'OK',
        headers: {},
        duration: 100,
      } as unknown as ResponseEvent;
      const r2 = {
        ...evt('network', 2000),
        type: 'response',
        statusCode: 200,
        statusText: 'OK',
        headers: {},
        duration: 200,
      } as unknown as ResponseEvent;
      const tl = buildTimeline([], [r1, r2], 'sess-1');
      expect(tl.stats.avgResponseTime).toBe(150);
    });

    it('avgResponseTime is undefined when no responses', () => {
      const tl = buildTimeline([], [evt('log', 1000)], 'sess-1');
      expect(tl.stats.avgResponseTime).toBeUndefined();
    });

    it('zero groups + zero events → clean stats', () => {
      const tl = buildTimeline([], [], 'sess-1');
      expect(tl.stats.totalEvents).toBe(0);
      expect(tl.stats.correlationGroups).toBe(0);
      expect(tl.stats.errors).toBe(0);
    });
  });
});
