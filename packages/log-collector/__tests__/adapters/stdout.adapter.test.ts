import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PassThrough } from 'node:stream';
import { StdoutLogAdapter } from '../../src/adapters/stdout.adapter.js';
import type { LogCollectorConfig, LogEvent } from '@nuptechs-probe/core';

function makeConfig(overrides: Partial<LogCollectorConfig> = {}): LogCollectorConfig {
  return {
    enabled: true,
    source: { type: 'stdout', name: 'test-stream' },
    ...overrides,
  };
}

function tick(ms = 50): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Write data to stream then send a sentinel line that forces the LogParser
 * to flush its previously-pending event. The sentinel itself becomes the
 * new pending event and is never emitted to handlers.
 */
async function writeAndFlush(stream: PassThrough, data: string): Promise<void> {
  stream.write(data);
  stream.write('__sentinel__\n');
  await tick();
}

describe('StdoutLogAdapter', () => {
  let stream: PassThrough;
  let adapter: StdoutLogAdapter;

  beforeEach(() => {
    stream = new PassThrough();
    adapter = new StdoutLogAdapter(stream);
  });

  afterEach(async () => {
    if (adapter.isConnected()) {
      await adapter.disconnect();
    }
    stream.destroy();
  });

  // ---- Lifecycle ----

  describe('connect / disconnect / isConnected', () => {
    it('isConnected is false before connect', () => {
      expect(adapter.isConnected()).toBe(false);
    });

    it('isConnected is true after connect', async () => {
      await adapter.connect(makeConfig());
      expect(adapter.isConnected()).toBe(true);
    });

    it('disconnect sets isConnected to false', async () => {
      await adapter.connect(makeConfig());
      await adapter.disconnect();
      expect(adapter.isConnected()).toBe(false);
    });

    it('calling connect when already connected disconnects first', async () => {
      await adapter.connect(makeConfig());
      await adapter.connect(makeConfig());
      expect(adapter.isConnected()).toBe(true);
    });
  });

  // ---- Source info ----

  describe('getSourceInfo', () => {
    it('returns config source after connect', async () => {
      const source = { type: 'stdout' as const, name: 'my-app' };
      await adapter.connect(makeConfig({ source }));
      expect(adapter.getSourceInfo()).toEqual(source);
    });
  });

  // ---- Event subscription ----

  describe('onLog', () => {
    it('registers handler and fires on log events', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((event) => received.push(event));

      await writeAndFlush(stream, '{"level":"info","msg":"hello"}\n');

      expect(received.length).toBeGreaterThanOrEqual(1);
      expect(received[0]!.message).toBe('hello');
    });

    it('returns unsubscribe function that stops events', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      const unsub = adapter.onLog((event) => received.push(event));

      await writeAndFlush(stream, '{"level":"info","msg":"first"}\n');
      expect(received).toHaveLength(1);

      unsub();

      await writeAndFlush(stream, '{"level":"info","msg":"second"}\n');
      // Should still be 1 — handler was unsubscribed
      expect(received).toHaveLength(1);
    });

    it('supports multiple handlers', async () => {
      await adapter.connect(makeConfig());
      const a: LogEvent[] = [];
      const b: LogEvent[] = [];
      adapter.onLog((e) => a.push(e));
      adapter.onLog((e) => b.push(e));

      await writeAndFlush(stream, '{"level":"info","msg":"multi"}\n');

      expect(a).toHaveLength(1);
      expect(b).toHaveLength(1);
    });
  });

  // ---- Parsing and emission ----

  describe('data processing', () => {
    it('parses JSON log lines from stream', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, '{"level":"error","msg":"disk full"}\n');

      expect(received).toHaveLength(1);
      expect(received[0]!.level).toBe('error');
      expect(received[0]!.message).toBe('disk full');
      expect(received[0]!.source).toBe('log');
    });

    it('parses plain text lines', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, 'ERROR something went wrong\n');

      expect(received).toHaveLength(1);
      expect(received[0]!.level).toBe('error');
    });

    it('sets rawLine on emitted events', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, 'plain message\n');

      expect(received[0]!.rawLine).toBe('plain message');
    });

    it('sets logSource from config', async () => {
      const source = { type: 'stdout' as const, name: 'my-service' };
      await adapter.connect(makeConfig({ source }));
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, 'hello\n');

      expect(received[0]!.logSource).toEqual(source);
    });
  });

  // ---- Filtering ----

  describe('level filtering', () => {
    it('only emits matching levels when config.levels is set', async () => {
      await adapter.connect(makeConfig({ levels: ['error', 'fatal'] }));
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, '{"level":"info","msg":"skip"}\n{"level":"error","msg":"keep"}\n{"level":"debug","msg":"skip2"}\n');

      expect(received).toHaveLength(1);
      expect(received[0]!.message).toBe('keep');
    });

    it('emits all levels when config.levels is undefined', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, '{"level":"info","msg":"a"}\n{"level":"error","msg":"b"}\n');

      expect(received).toHaveLength(2);
    });
  });

  describe('pattern filtering', () => {
    it('only emits when rawLine matches config.patterns', async () => {
      await adapter.connect(makeConfig({ patterns: ['CRITICAL'] }));
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, 'nothing to see here\nCRITICAL system failure\n');

      expect(received).toHaveLength(1);
      expect(received[0]!.rawLine).toContain('CRITICAL');
    });
  });

  // ---- Line buffer ----

  describe('lineBuffer handling', () => {
    it('handles incomplete lines across chunks', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      stream.write('{"level":"info","msg":');
      stream.write('"split"}\n');
      stream.write('__sentinel__\n');
      await tick();

      expect(received).toHaveLength(1);
      expect(received[0]!.message).toBe('split');
    });

    it('handles multiple lines in one chunk', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      await writeAndFlush(stream, 'line one\nline two\nline three\n');

      expect(received).toHaveLength(3);
    });
  });

  describe('MAX_LINE_BUFFER overflow', () => {
    it('force-flushes oversized combined buffer', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      const bigChunk = 'X'.repeat(600_000);
      stream.write(bigChunk);
      stream.write(bigChunk);
      stream.write('\n__sentinel__\n');
      await tick();

      expect(received.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---- Stream end ----

  describe('stream end', () => {
    it('flushes parser and sets connected=false on stream end', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      stream.write('{"level":"info","msg":"last"}');
      stream.end();
      await tick();

      expect(adapter.isConnected()).toBe(false);
    });

    it('emits pending event on stream end', async () => {
      await adapter.connect(makeConfig());
      const received: LogEvent[] = [];
      adapter.onLog((e) => received.push(e));

      stream.write('{"level":"warn","msg":"final"}\n');
      stream.end();
      await tick();

      expect(received).toHaveLength(1);
      expect(received[0]!.message).toBe('final');
    });
  });
});
