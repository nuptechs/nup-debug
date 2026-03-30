// ============================================================
// W3C Trace Context — Comprehensive tests
// ============================================================

import { describe, it, expect } from 'vitest';
import {
  parseTraceparent,
  formatTraceparent,
  createTraceContext,
  createChildContext,
  generateTraceId,
  generateSpanId,
} from '../../src/utils/trace-context.js';

describe('Trace Context', () => {
  describe('parseTraceparent', () => {
    it('parses a valid traceparent', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const ctx = parseTraceparent(header);
      expect(ctx).toEqual({
        version: '00',
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        parentSpanId: '00f067aa0ba902b7',
        traceFlags: 1,
      });
    });

    it('handles traceFlags 0 (not sampled)', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-00';
      const ctx = parseTraceparent(header);
      expect(ctx?.traceFlags).toBe(0);
    });

    it('rejects all-zero traceId', () => {
      const header = '00-00000000000000000000000000000000-00f067aa0ba902b7-01';
      expect(parseTraceparent(header)).toBeNull();
    });

    it('rejects all-zero spanId', () => {
      const header = '00-4bf92f3577b34da6a3ce929d0e0e4736-0000000000000000-01';
      expect(parseTraceparent(header)).toBeNull();
    });

    it('rejects malformed headers', () => {
      expect(parseTraceparent('')).toBeNull();
      expect(parseTraceparent('not-a-trace')).toBeNull();
      expect(parseTraceparent('00-short-00f067aa0ba902b7-01')).toBeNull();
    });

    it('rejects non-string input', () => {
      expect(parseTraceparent(null as any)).toBeNull();
      expect(parseTraceparent(123 as any)).toBeNull();
      expect(parseTraceparent(undefined as any)).toBeNull();
    });

    it('trims whitespace', () => {
      const header = '  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01  ';
      expect(parseTraceparent(header)).not.toBeNull();
    });

    it('normalizes to lowercase', () => {
      const header = '00-4BF92F3577B34DA6A3CE929D0E0E4736-00F067AA0BA902B7-01';
      const ctx = parseTraceparent(header);
      expect(ctx?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    });
  });

  describe('formatTraceparent', () => {
    it('formats a TraceContext into a valid traceparent string', () => {
      const ctx = {
        version: '00' as const,
        traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
        parentSpanId: '00f067aa0ba902b7',
        traceFlags: 1,
      };
      expect(formatTraceparent(ctx)).toBe(
        '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      );
    });

    it('pads flags to two hex digits', () => {
      const ctx = {
        version: '00' as const,
        traceId: 'a'.repeat(32),
        parentSpanId: 'b'.repeat(16),
        traceFlags: 0,
      };
      expect(formatTraceparent(ctx).endsWith('-00')).toBe(true);
    });

    it('round-trips with parseTraceparent', () => {
      const original = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
      const ctx = parseTraceparent(original)!;
      expect(formatTraceparent(ctx)).toBe(original);
    });
  });

  describe('createTraceContext', () => {
    it('creates a sampled context by default', () => {
      const ctx = createTraceContext();
      expect(ctx.version).toBe('00');
      expect(ctx.traceId).toHaveLength(32);
      expect(ctx.parentSpanId).toHaveLength(16);
      expect(ctx.traceFlags).toBe(1);
    });

    it('creates an unsampled context when requested', () => {
      const ctx = createTraceContext(false);
      expect(ctx.traceFlags).toBe(0);
    });

    it('generates unique IDs each time', () => {
      const a = createTraceContext();
      const b = createTraceContext();
      expect(a.traceId).not.toBe(b.traceId);
      expect(a.parentSpanId).not.toBe(b.parentSpanId);
    });
  });

  describe('createChildContext', () => {
    it('preserves traceId from parent', () => {
      const parent = createTraceContext();
      const child = createChildContext(parent);
      expect(child.traceId).toBe(parent.traceId);
    });

    it('generates new spanId', () => {
      const parent = createTraceContext();
      const child = createChildContext(parent);
      expect(child.parentSpanId).not.toBe(parent.parentSpanId);
    });

    it('preserves traceFlags from parent', () => {
      const parent = createTraceContext(false);
      const child = createChildContext(parent);
      expect(child.traceFlags).toBe(0);
    });
  });

  describe('generateTraceId', () => {
    it('generates 32-char hex string', () => {
      const id = generateTraceId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
      expect(ids.size).toBe(100);
    });
  });

  describe('generateSpanId', () => {
    it('generates 16-char hex string', () => {
      const id = generateSpanId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it('generates unique IDs', () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
      expect(ids.size).toBe(100);
    });
  });
});
