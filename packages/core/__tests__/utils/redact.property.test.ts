// ============================================================
// Redact — Property-based tests (fast-check)
//
// Invariants:
//   R1. isSensitiveKey is case-insensitive and ignores [-_]
//   R2. redactHeaders preserves the same keys
//   R3. redactHeaders idempotent (running twice == once)
//   R4. redactHeaders never leaks a sensitive value verbatim
//   R5. redactBody redacts JWTs / bearer tokens / credit cards
//   R6. redactBody idempotent
//   R7. maskValue: short inputs (len ≤ 2*visible) → fully masked, length preserved
//   R8. maskValue: long inputs → prefix/suffix preserved, middle is stars (≥ 4)
// ============================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  isSensitiveKey,
  redactHeaders,
  redactBody,
  maskValue,
} from '../../src/utils/redact.js';

const SENSITIVE = [
  'password', 'token', 'authorization', 'cookie',
  'apiKey', 'api_key', 'API-KEY', 'access_token', 'refreshToken',
  'creditCard', 'cvv', 'ssn',
];
const NON_SENSITIVE = [
  'username', 'name', 'email', 'requestId',
  'timestamp', 'method', 'path', 'status',
];

describe('redact — property tests', () => {
  it('R1: isSensitiveKey is case- and separator-insensitive', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SENSITIVE),
        fc.array(fc.constantFrom('-', '_', ''), { maxLength: 4 }),
        (key, sepInjections) => {
          const upper = key.toUpperCase();
          const mixed = key
            .split('')
            .map((c, i) => (i % 2 === 0 ? c.toUpperCase() : c.toLowerCase()))
            .join('');
          const withSeps = sepInjections.length
            ? key.split('').join(sepInjections[0] || '')
            : key;
          expect(isSensitiveKey(key)).toBe(true);
          expect(isSensitiveKey(upper)).toBe(true);
          expect(isSensitiveKey(mixed)).toBe(true);
          expect(isSensitiveKey(withSeps)).toBe(true);
        },
      ),
    );
  });

  it('R2+R3+R4: redactHeaders preserves keys, idempotent, never leaks sensitive value', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.constantFrom(...SENSITIVE, ...NON_SENSITIVE),
          fc.string({ minLength: 1, maxLength: 30 }),
          { maxKeys: 12 },
        ),
        (headers) => {
          const once = redactHeaders(headers);
          const twice = redactHeaders(once);
          expect(Object.keys(once).sort()).toEqual(Object.keys(headers).sort());
          expect(twice).toEqual(once);
          for (const [k, v] of Object.entries(headers)) {
            if (isSensitiveKey(k)) {
              expect(once[k]).toBe('[REDACTED]');
              // sensitive value never leaks unless it happens to *be* "[REDACTED]"
              if (v !== '[REDACTED]') expect(once[k]).not.toBe(v);
            } else {
              expect(once[k]).toBe(v);
            }
          }
        },
      ),
    );
  });

  it('R5: redactBody removes Bearer tokens, JWTs, credit-card numbers, SSNs', () => {
    const jwtArb = fc
      .tuple(
        fc.string({ minLength: 5, maxLength: 20 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s) && s.length > 0),
        fc.string({ minLength: 5, maxLength: 20 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s) && s.length > 0),
        fc.string({ minLength: 5, maxLength: 20 }).filter(s => /^[A-Za-z0-9_-]+$/.test(s) && s.length > 0),
      )
      .map(([a, b, c]) => `eyJ${a}.eyJ${b}.${c}`);

    const ccArb = fc
      .tuple(fc.integer({ min: 1000, max: 9999 }), fc.integer({ min: 1000, max: 9999 }), fc.integer({ min: 1000, max: 9999 }), fc.integer({ min: 1000, max: 9999 }))
      .map(([a, b, c, d]) => `${a}-${b}-${c}-${d}`);

    const ssnArb = fc
      .tuple(fc.integer({ min: 100, max: 999 }), fc.integer({ min: 10, max: 99 }), fc.integer({ min: 1000, max: 9999 }))
      .map(([a, b, c]) => `${a}-${b}-${c}`);

    const bearerArb = fc.string({ minLength: 8, maxLength: 40 })
      .filter(s => /^[A-Za-z0-9\-._~+/]+=*$/.test(s) && s.length >= 8)
      .map(t => `Bearer ${t}`);

    // Wrap secret with whitespace to keep regex word-boundaries intact
    // (e.g. SSN \b\d{3}-\d{2}-\d{4}\b breaks if pre/suffix is a digit).
    const safeText = fc.string({ maxLength: 30 }).map(s => s.replace(/[A-Za-z0-9.\-_/+~=]/g, ' '));
    fc.assert(
      fc.property(
        fc.oneof(jwtArb, ccArb, ssnArb, bearerArb),
        safeText,
        safeText,
        (secret, prefix, suffix) => {
          const body = `${prefix} ${secret} ${suffix}`;
          const out = redactBody(body);
          expect(out).toContain('[REDACTED]');
          expect(out).not.toContain(secret);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('R6: redactBody is idempotent', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (s) => {
        const a = redactBody(s);
        const b = redactBody(a);
        expect(b).toBe(a);
      }),
    );
  });

  it('R7+R8: maskValue preserves length and bounds visible characters', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 60 }),
        fc.integer({ min: 1, max: 6 }),
        (value, visible) => {
          const masked = maskValue(value, visible);
          if (value.length <= visible * 2) {
            // fully masked, preserves length
            expect(masked).toBe('*'.repeat(value.length));
          } else {
            // first/last `visible` chars preserved; middle is stars (min 4)
            const middleStars = Math.max(value.length - visible * 2, 4);
            expect(masked).toHaveLength(visible * 2 + middleStars);
            expect(masked.slice(0, visible)).toBe(value.slice(0, visible));
            expect(masked.slice(-visible)).toBe(value.slice(-visible));
            expect(masked.slice(visible, masked.length - visible)).toBe(
              '*'.repeat(middleStars),
            );
          }
        },
      ),
    );
  });

  it('redactBody does not crash on empty / weird input', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        expect(() => redactBody(s)).not.toThrow();
      }),
    );
  });
});
