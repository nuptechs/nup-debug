import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLogLine, LogParser } from '../../src/parser/log-parser.js';
import type { ParsedLine } from '../../src/parser/log-parser.js';

// ============================================================
// parseLogLine — stateless single-line parsing
// ============================================================

describe('parseLogLine', () => {
  describe('JSON structured logs', () => {
    it('extracts level from "level" field', () => {
      const result = parseLogLine('{"level":"error","msg":"disk full"}');
      expect(result.level).toBe('error');
      expect(result.message).toBe('disk full');
    });

    it('extracts level from "severity" field', () => {
      const result = parseLogLine('{"severity":"warn","message":"slow query"}');
      expect(result.level).toBe('warn');
      expect(result.message).toBe('slow query');
    });

    it('extracts level from "lvl" field', () => {
      const result = parseLogLine('{"lvl":"debug","text":"cache miss"}');
      expect(result.level).toBe('debug');
      expect(result.message).toBe('cache miss');
    });

    it('extracts message from "msg" field', () => {
      const result = parseLogLine('{"level":"info","msg":"hello world"}');
      expect(result.message).toBe('hello world');
    });

    it('extracts message from "message" field', () => {
      const result = parseLogLine('{"level":"info","message":"hello world"}');
      expect(result.message).toBe('hello world');
    });

    it('extracts message from "text" field', () => {
      const result = parseLogLine('{"level":"info","text":"hello world"}');
      expect(result.message).toBe('hello world');
    });

    it('extracts loggerName from "logger" field', () => {
      const result = parseLogLine('{"level":"info","msg":"x","logger":"com.app.Foo"}');
      expect(result.loggerName).toBe('com.app.Foo');
    });

    it('extracts loggerName from "loggerName" field', () => {
      const result = parseLogLine('{"level":"info","msg":"x","loggerName":"app.service"}');
      expect(result.loggerName).toBe('app.service');
    });

    it('extracts loggerName from "name" field as fallback', () => {
      const result = parseLogLine('{"level":"info","msg":"x","name":"mylogger"}');
      expect(result.loggerName).toBe('mylogger');
    });

    it('extracts threadName from "thread" field', () => {
      const result = parseLogLine('{"level":"info","msg":"x","thread":"main"}');
      expect(result.threadName).toBe('main');
    });

    it('extracts threadName from "threadName" field', () => {
      const result = parseLogLine('{"level":"info","msg":"x","threadName":"worker-1"}');
      expect(result.threadName).toBe('worker-1');
    });

    it('extracts stackTrace from "stack" field', () => {
      const result = parseLogLine('{"level":"error","msg":"fail","stack":"Error\\n  at foo"}');
      expect(result.stackTrace).toBe('Error\n  at foo');
    });

    it('extracts stackTrace from "stackTrace" field', () => {
      const result = parseLogLine('{"level":"error","msg":"fail","stackTrace":"Error\\n  at bar"}');
      expect(result.stackTrace).toBe('Error\n  at bar');
    });

    it('extracts stackTrace from "err.stack" field', () => {
      const result = parseLogLine('{"level":"error","msg":"fail","err":{"stack":"Error\\n  at baz"}}');
      expect(result.stackTrace).toBe('Error\n  at baz');
    });

    it('puts unknown fields in structured', () => {
      const result = parseLogLine('{"level":"info","msg":"x","requestId":"abc-123","userId":42}');
      expect(result.structured).toEqual({ requestId: 'abc-123', userId: 42 });
    });

    it('does not set structured when no extra fields', () => {
      const result = parseLogLine('{"level":"info","msg":"hello"}');
      expect(result.structured).toBeUndefined();
    });
  });

  describe('JSON numeric levels (pino-style)', () => {
    it('≤10 → trace', () => {
      expect(parseLogLine('{"level":10,"msg":"t"}').level).toBe('trace');
      expect(parseLogLine('{"level":5,"msg":"t"}').level).toBe('trace');
    });

    it('≤20 → debug', () => {
      expect(parseLogLine('{"level":20,"msg":"d"}').level).toBe('debug');
      expect(parseLogLine('{"level":15,"msg":"d"}').level).toBe('debug');
    });

    it('≤30 → info', () => {
      expect(parseLogLine('{"level":30,"msg":"i"}').level).toBe('info');
      expect(parseLogLine('{"level":25,"msg":"i"}').level).toBe('info');
    });

    it('≤40 → warn', () => {
      expect(parseLogLine('{"level":40,"msg":"w"}').level).toBe('warn');
      expect(parseLogLine('{"level":35,"msg":"w"}').level).toBe('warn');
    });

    it('≤50 → error', () => {
      expect(parseLogLine('{"level":50,"msg":"e"}').level).toBe('error');
      expect(parseLogLine('{"level":45,"msg":"e"}').level).toBe('error');
    });

    it('>50 → fatal', () => {
      expect(parseLogLine('{"level":60,"msg":"f"}').level).toBe('fatal');
      expect(parseLogLine('{"level":100,"msg":"f"}').level).toBe('fatal');
    });
  });

  describe('Spring Boot format', () => {
    it('parses standard Spring Boot log line', () => {
      const line = '2026-03-29 12:00:00.000 INFO [main] c.p.App : Server started';
      const result = parseLogLine(line);
      expect(result.level).toBe('info');
      expect(result.threadName).toBe('main');
      expect(result.loggerName).toBe('c.p.App');
      expect(result.message).toBe('Server started');
    });

    it('parses ERROR level Spring Boot line', () => {
      const line = '2026-03-29 12:00:00.000 ERROR [http-nio-8080] c.p.Controller : Unhandled exception';
      const result = parseLogLine(line);
      expect(result.level).toBe('error');
      expect(result.threadName).toBe('http-nio-8080');
      expect(result.loggerName).toBe('c.p.Controller');
      expect(result.message).toBe('Unhandled exception');
    });
  });

  describe('Log4j bracket format', () => {
    it('parses [LEVEL] logger - message', () => {
      const result = parseLogLine('[ERROR] c.p.App - Something broke');
      expect(result.level).toBe('error');
      expect(result.loggerName).toBe('c.p.App');
      expect(result.message).toBe('Something broke');
    });

    it('parses [WARN] logger - message', () => {
      const result = parseLogLine('[WARN] com.example.Service - Slow response');
      expect(result.level).toBe('warn');
      expect(result.loggerName).toBe('com.example.Service');
      expect(result.message).toBe('Slow response');
    });
  });

  describe('Syslog format', () => {
    it('parses syslog line and extracts severity from priority', () => {
      // priority 34 = facility 4 (auth), severity 2 (critical) → fatal
      const line = '<34>Mar 29 12:00:00 localhost myapp[1234]: Something critical';
      const result = parseLogLine(line);
      expect(result.level).toBe('fatal');
      expect(result.loggerName).toBe('myapp');
      expect(result.message).toBe('Something critical');
    });

    it('severity 3 → error', () => {
      // priority 11 = facility 1 (user), severity 3 (error)
      const line = '<11>Mar 29 12:00:00 host app[99]: error msg';
      const result = parseLogLine(line);
      expect(result.level).toBe('error');
    });

    it('severity 4 → warn', () => {
      // priority 12 = facility 1, severity 4 (warning)
      const line = '<12>Mar 29 12:00:00 host app[99]: warn msg';
      const result = parseLogLine(line);
      expect(result.level).toBe('warn');
    });

    it('severity 6 → info', () => {
      // priority 14 = facility 1, severity 6 (informational)
      const line = '<14>Mar 29 12:00:00 host app[99]: info msg';
      const result = parseLogLine(line);
      expect(result.level).toBe('info');
    });

    it('severity 7 → debug', () => {
      // priority 15 = facility 1, severity 7 (debug)
      const line = '<15>Mar 29 12:00:00 host app[99]: debug msg';
      const result = parseLogLine(line);
      expect(result.level).toBe('debug');
    });
  });

  describe('plain text with level keyword', () => {
    it('detects ERROR keyword in text', () => {
      const result = parseLogLine('Something happened ERROR in the system');
      expect(result.level).toBe('error');
      expect(result.message).toBe('Something happened ERROR in the system');
    });

    it('detects WARN keyword', () => {
      const result = parseLogLine('WARN: disk is 90% full');
      expect(result.level).toBe('warn');
    });

    it('detects FATAL keyword', () => {
      const result = parseLogLine('FATAL process crash');
      expect(result.level).toBe('fatal');
    });

    it('defaults to info when no level keyword found', () => {
      const result = parseLogLine('Just a plain message');
      expect(result.level).toBe('info');
      expect(result.message).toBe('Just a plain message');
    });
  });

  describe('edge cases', () => {
    it('empty string → info + empty message', () => {
      const result = parseLogLine('');
      expect(result.level).toBe('info');
      expect(result.message).toBe('');
    });

    it('whitespace-only string → info + empty message', () => {
      const result = parseLogLine('   \t  ');
      expect(result.level).toBe('info');
      expect(result.message).toBe('');
    });

    it('invalid JSON starting with { falls through to other parsers', () => {
      const result = parseLogLine('{not valid json at all}');
      // Should not crash — falls through to plain text
      expect(result.level).toBeDefined();
      expect(result.message).toBeDefined();
    });
  });
});

// ============================================================
// LogParser — stateful parser with stack trace accumulation
// ============================================================

describe('LogParser', () => {
  let events: Array<{ parsed: ParsedLine; rawLine: string }>;
  let parser: LogParser;

  beforeEach(() => {
    events = [];
    parser = new LogParser((parsed, rawLine) => {
      events.push({ parsed, rawLine });
    });
  });

  it('feedLine parses and emits via callback on next feedLine', () => {
    parser.feedLine('{"level":"info","msg":"hello"}');
    // Not emitted yet (buffered as pending)
    expect(events).toHaveLength(0);
    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed.message).toBe('hello');
  });

  it('new non-stack line flushes previous event', () => {
    parser.feedLine('{"level":"info","msg":"first"}');
    parser.feedLine('{"level":"warn","msg":"second"}');
    // First should have been flushed
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed.message).toBe('first');
    parser.flush();
    expect(events).toHaveLength(2);
    expect(events[1]!.parsed.message).toBe('second');
  });

  it('accumulates stack trace lines with \\tat prefix', () => {
    parser.feedLine('{"level":"error","msg":"NullPointer"}');
    parser.feedLine('\tat com.example.Foo.bar(Foo.java:42)');
    parser.feedLine('\tat com.example.Main.run(Main.java:10)');
    // Still pending
    expect(events).toHaveLength(0);
    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed.stackTrace).toContain('com.example.Foo.bar');
    expect(events[0]!.parsed.stackTrace).toContain('com.example.Main.run');
  });

  it('accumulates "    at ..." (space-indented) stack lines', () => {
    parser.feedLine('{"level":"error","msg":"ReferenceError"}');
    parser.feedLine('    at Object.<anonymous> (index.js:5:1)');
    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed.stackTrace).toContain('Object.<anonymous>');
  });

  it('"Caused by:" lines are treated as stack continuation', () => {
    parser.feedLine('{"level":"error","msg":"Wrapper"}');
    parser.feedLine('\tat com.example.Foo.bar(Foo.java:42)');
    parser.feedLine('Caused by: java.lang.NullPointerException');
    parser.feedLine('\tat com.example.Inner.baz(Inner.java:7)');
    parser.flush();
    expect(events).toHaveLength(1);
    expect(events[0]!.parsed.stackTrace).toContain('Caused by:');
    expect(events[0]!.parsed.stackTrace).toContain('Inner.baz');
  });

  it('flush emits pending event and clears state', () => {
    parser.feedLine('{"level":"info","msg":"pending"}');
    parser.flush();
    expect(events).toHaveLength(1);
    // second flush is a no-op
    parser.flush();
    expect(events).toHaveLength(1);
  });

  it('rawLine includes accumulated stack trace lines', () => {
    parser.feedLine('{"level":"error","msg":"crash"}');
    parser.feedLine('\tat com.Foo.bar(Foo.java:1)');
    parser.flush();
    expect(events[0]!.rawLine).toContain('{"level":"error","msg":"crash"}');
    expect(events[0]!.rawLine).toContain('\tat com.Foo.bar(Foo.java:1)');
  });
});
