import { describe, it, expect } from 'vitest';
import {
  generateId,
  generateShortId,
  generateCorrelationId,
  generateSessionId,
  generateRequestId,
} from '../../src/utils/id-generator.js';

describe('generateId', () => {
  it('returns a valid UUID v4', () => {
    const id = generateId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateShortId', () => {
  it('returns 8 hex characters', () => {
    expect(generateShortId()).toMatch(/^[0-9a-f]{8}$/);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateShortId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateCorrelationId', () => {
  it('is prefixed with "probe-"', () => {
    expect(generateCorrelationId()).toMatch(/^probe-[0-9a-f]{16}$/);
  });

  it('produces unique values', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateCorrelationId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateSessionId', () => {
  it('is prefixed with "sess-" followed by a UUID', () => {
    expect(generateSessionId()).toMatch(
      /^sess-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('generateRequestId', () => {
  it('is prefixed with "req-" followed by 12 hex chars', () => {
    expect(generateRequestId()).toMatch(/^req-[0-9a-f]{12}$/);
  });
});
