import { describe, it, expect } from 'vitest';
import {
  normalizeLevel,
  SPRING_BOOT_PATTERN,
  LOG4J_PATTERN,
  SYSLOG_PATTERN,
  DOCKER_PREFIX_PATTERN,
  STACK_TRACE_LINE,
  JSON_PREFIX,
  PLAIN_LEVEL_PATTERN,
} from '../../src/parser/patterns.js';

// ============================================================
// normalizeLevel
// ============================================================

describe('normalizeLevel', () => {
  describe('full names — lowercase', () => {
    it.each([
      ['trace', 'trace'],
      ['debug', 'debug'],
      ['info', 'info'],
      ['warn', 'warn'],
      ['error', 'error'],
      ['fatal', 'fatal'],
    ] as const)('"%s" → "%s"', (input, expected) => {
      expect(normalizeLevel(input)).toBe(expected);
    });
  });

  describe('full names — uppercase', () => {
    it.each([
      ['TRACE', 'trace'],
      ['DEBUG', 'debug'],
      ['INFO', 'info'],
      ['WARN', 'warn'],
      ['ERROR', 'error'],
      ['FATAL', 'fatal'],
    ] as const)('"%s" → "%s"', (input, expected) => {
      expect(normalizeLevel(input)).toBe(expected);
    });
  });

  describe('aliases', () => {
    it.each([
      ['warning', 'warn'],
      ['WARNING', 'warn'],
      ['err', 'error'],
      ['ERR', 'error'],
      ['critical', 'fatal'],
      ['CRITICAL', 'fatal'],
      ['severe', 'error'],
      ['SEVERE', 'error'],
      ['information', 'info'],
      ['INFORMATION', 'info'],
    ] as const)('"%s" → "%s"', (input, expected) => {
      expect(normalizeLevel(input)).toBe(expected);
    });
  });

  describe('single-char abbreviations', () => {
    it.each([
      ['T', 'trace'],
      ['D', 'debug'],
      ['I', 'info'],
      ['W', 'warn'],
      ['E', 'error'],
      ['F', 'fatal'],
    ] as const)('"%s" → "%s"', (input, expected) => {
      expect(normalizeLevel(input)).toBe(expected);
    });
  });

  describe('mixed case falls back via toLowerCase', () => {
    it('"Warn" → "warn"', () => {
      expect(normalizeLevel('Warn')).toBe('warn');
    });

    it('"Error" → "error"', () => {
      expect(normalizeLevel('Error')).toBe('error');
    });

    it('"Info" → "info"', () => {
      expect(normalizeLevel('Info')).toBe('info');
    });
  });

  describe('unknown strings → info default', () => {
    it('"banana" → "info"', () => {
      expect(normalizeLevel('banana')).toBe('info');
    });

    it('"" → "info"', () => {
      expect(normalizeLevel('')).toBe('info');
    });

    it('"42" → "info"', () => {
      expect(normalizeLevel('42')).toBe('info');
    });
  });
});

// ============================================================
// Regex patterns
// ============================================================

describe('SPRING_BOOT_PATTERN', () => {
  it('matches standard Spring Boot log line', () => {
    const line = '2026-03-29 12:00:00.000 INFO [main] c.p.App : Server started';
    const m = SPRING_BOOT_PATTERN.exec(line);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('2026-03-29 12:00:00.000'); // timestamp
    expect(m![2]).toBe('INFO');                     // level
    expect(m![3]).toBe('main');                     // thread
    expect(m![4]).toBe('c.p.App');                  // logger
    expect(m![5]).toBe('Server started');            // message
  });

  it('matches ERROR level with complex thread name', () => {
    const line = '2026-01-15 09:30:45.123 ERROR [http-nio-8080-exec-1] com.example.Controller : Failed';
    const m = SPRING_BOOT_PATTERN.exec(line);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('ERROR');
    expect(m![3]).toBe('http-nio-8080-exec-1');
  });

  it('does not match plain text', () => {
    expect(SPRING_BOOT_PATTERN.test('Just a plain log line')).toBe(false);
  });
});

describe('LOG4J_PATTERN', () => {
  it('matches [LEVEL] logger - message', () => {
    const m = LOG4J_PATTERN.exec('[ERROR] c.p.App - Something broke');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('ERROR');
    expect(m![2]).toBe('c.p.App');
    expect(m![3]).toBe('Something broke');
  });

  it('matches [WARN] with dotted logger', () => {
    const m = LOG4J_PATTERN.exec('[WARN] com.example.Service - Slow');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('WARN');
    expect(m![2]).toBe('com.example.Service');
  });

  it('does not match lines without brackets', () => {
    expect(LOG4J_PATTERN.test('ERROR c.p.App - no brackets')).toBe(false);
  });
});

describe('SYSLOG_PATTERN', () => {
  it('matches syslog with PID', () => {
    const line = '<34>Mar 29 12:00:00 localhost myapp[1234]: critical message';
    const m = SYSLOG_PATTERN.exec(line);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('34');                    // priority
    expect(m![2]).toBe('Mar 29 12:00:00');       // timestamp
    expect(m![3]).toBe('localhost');              // hostname
    expect(m![4]).toBe('myapp');                 // appname
    expect(m![5]).toBe('1234');                  // pid
    expect(m![6]).toBe('critical message');       // message
  });

  it('matches syslog without PID', () => {
    const line = '<14>Jan  1 00:00:00 host app: test';
    const m = SYSLOG_PATTERN.exec(line);
    expect(m).not.toBeNull();
    expect(m![4]).toBe('app');
    expect(m![5]).toBeUndefined();
  });

  it('does not match non-syslog lines', () => {
    expect(SYSLOG_PATTERN.test('regular log line')).toBe(false);
  });
});

describe('DOCKER_PREFIX_PATTERN', () => {
  it('matches Docker log with stdout', () => {
    const line = '2026-03-29T12:00:00.000000000Z stdout F Hello from container';
    const m = DOCKER_PREFIX_PATTERN.exec(line);
    expect(m).not.toBeNull();
    expect(m![1]).toBe('2026-03-29T12:00:00.000000000Z');
    expect(m![2]).toBe('stdout');
    expect(m![3]).toBe('Hello from container');
  });

  it('matches Docker log with stderr', () => {
    const line = '2026-03-29T12:00:00.123Z stderr P error output';
    const m = DOCKER_PREFIX_PATTERN.exec(line);
    expect(m).not.toBeNull();
    expect(m![2]).toBe('stderr');
  });

  it('does not match non-Docker prefixed lines', () => {
    expect(DOCKER_PREFIX_PATTERN.test('Just a plain log')).toBe(false);
  });
});

describe('STACK_TRACE_LINE', () => {
  it('matches tab-indented "at" lines', () => {
    expect(STACK_TRACE_LINE.test('\tat com.example.Foo.bar(Foo.java:42)')).toBe(true);
  });

  it('matches space-indented "at" lines', () => {
    expect(STACK_TRACE_LINE.test('    at Object.<anonymous> (index.js:5:1)')).toBe(true);
  });

  it('matches "Caused by:" lines', () => {
    expect(STACK_TRACE_LINE.test('Caused by: java.lang.NullPointerException')).toBe(true);
  });

  it('does not match regular lines', () => {
    expect(STACK_TRACE_LINE.test('INFO starting application')).toBe(false);
  });
});

describe('JSON_PREFIX', () => {
  it('matches lines starting with {', () => {
    expect(JSON_PREFIX.test('{"level":"info"}')).toBe(true);
  });

  it('matches with leading whitespace', () => {
    expect(JSON_PREFIX.test('  {"level":"info"}')).toBe(true);
  });

  it('does not match lines not starting with {', () => {
    expect(JSON_PREFIX.test('INFO some message')).toBe(false);
  });
});

describe('PLAIN_LEVEL_PATTERN', () => {
  it('matches ERROR keyword in text', () => {
    const m = PLAIN_LEVEL_PATTERN.exec('Something ERROR happened');
    expect(m).not.toBeNull();
    expect(m![1]).toBe('ERROR');
  });

  it('matches WARN keyword', () => {
    expect(PLAIN_LEVEL_PATTERN.test('WARN low disk')).toBe(true);
  });

  it('matches WARNING keyword', () => {
    expect(PLAIN_LEVEL_PATTERN.test('WARNING: timeout')).toBe(true);
  });

  it('matches case-insensitively', () => {
    const m = PLAIN_LEVEL_PATTERN.exec('some Fatal error');
    expect(m).not.toBeNull();
    expect(m![1]!.toUpperCase()).toBe('FATAL');
  });

  it('does not match partial words', () => {
    // "information" should not match as INFO (word boundary)
    const m = PLAIN_LEVEL_PATTERN.exec('information about something');
    expect(m).toBeNull();
  });
});
