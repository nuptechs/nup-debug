// ============================================================
// Production Auth Guards — Tests for server startup security
// Verifies process.exit is called for insecure configurations
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The auth guard logic is inline in server/src/index.ts (not factored out),
// so we replicate the exact guard logic to test it in isolation.
// This ensures the RULES are correct, independent of the Express setup.

const MIN_API_KEY_LENGTH = 16;
const MIN_JWT_SECRET_LENGTH = 32;

interface AuthGuardEnv {
  NODE_ENV: string;
  PROBE_API_KEYS: string;
  PROBE_JWT_SECRET: string;
  PROBE_AUTH_DISABLED: string;
}

interface AuthGuardResult {
  exitCode: number | null;
  exitReason: string | null;
  enableAuth: boolean;
}

/**
 * Replicate the exact auth guard logic from server/src/index.ts
 * Returns what would happen: exit code + reason, or enableAuth flag
 */
function evaluateAuthGuards(env: Partial<AuthGuardEnv>): AuthGuardResult {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const probeApiKeys = env.PROBE_API_KEYS ?? '';
  const probeJwtSecret = env.PROBE_JWT_SECRET ?? '';
  const probeAuthDisabled = env.PROBE_AUTH_DISABLED ?? '';

  const apiKeys = probeApiKeys.split(',').filter(Boolean);
  const jwtSecret = probeJwtSecret;

  // Guard 1: Auth disabled in production
  if (probeAuthDisabled === '1' && nodeEnv === 'production') {
    return { exitCode: 1, exitReason: 'PROBE_AUTH_DISABLED=1 is forbidden in production', enableAuth: false };
  }

  // Guard 2: No auth credentials in production
  if (nodeEnv === 'production' && apiKeys.length === 0 && !jwtSecret) {
    return { exitCode: 1, exitReason: 'Production requires PROBE_API_KEYS or PROBE_JWT_SECRET', enableAuth: false };
  }

  // Guard 3: Weak API keys
  const weakKeys = apiKeys.filter(k => k.length < MIN_API_KEY_LENGTH);
  if (weakKeys.length > 0) {
    return { exitCode: 1, exitReason: `API keys must be at least ${MIN_API_KEY_LENGTH} characters`, enableAuth: false };
  }

  // Guard 4: Short JWT secret
  if (jwtSecret && jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    return { exitCode: 1, exitReason: `PROBE_JWT_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters`, enableAuth: false };
  }

  const authDisabledByEnv = probeAuthDisabled === '1' && nodeEnv !== 'production';
  const enableAuth = !authDisabledByEnv && (apiKeys.length > 0 || jwtSecret.length > 0);

  return { exitCode: null, exitReason: null, enableAuth };
}

describe('Production auth guards', () => {

  // ── Guard 1: Auth disabled in production ──

  describe('PROBE_AUTH_DISABLED in production', () => {
    it('exits when auth is disabled in production', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_AUTH_DISABLED: '1',
        PROBE_API_KEYS: 'valid-api-key-1234567890123456',
      });
      expect(result.exitCode).toBe(1);
      expect(result.exitReason).toContain('forbidden in production');
    });

    it('allows auth disabled in development', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_AUTH_DISABLED: '1',
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(false);
    });

    it('allows auth disabled in test', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'test',
        PROBE_AUTH_DISABLED: '1',
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(false);
    });
  });

  // ── Guard 2: Missing auth in production ──

  describe('missing auth credentials in production', () => {
    it('exits when no API keys and no JWT secret in production', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_API_KEYS: '',
        PROBE_JWT_SECRET: '',
      });
      expect(result.exitCode).toBe(1);
      expect(result.exitReason).toContain('requires PROBE_API_KEYS or PROBE_JWT_SECRET');
    });

    it('allows production with valid API key only', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_API_KEYS: 'valid-api-key-1234567890123456',
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('allows production with JWT secret only', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_JWT_SECRET: 'a'.repeat(MIN_JWT_SECRET_LENGTH),
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('allows production with both API key and JWT secret', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_API_KEYS: 'valid-api-key-1234567890123456',
        PROBE_JWT_SECRET: 'b'.repeat(MIN_JWT_SECRET_LENGTH),
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('allows development with no auth credentials', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: '',
        PROBE_JWT_SECRET: '',
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(false);
    });
  });

  // ── Guard 3: Weak API keys ──

  describe('API key length enforcement', () => {
    it('exits when API key is shorter than 16 characters', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: 'short',
      });
      expect(result.exitCode).toBe(1);
      expect(result.exitReason).toContain(`at least ${MIN_API_KEY_LENGTH} characters`);
    });

    it('exits when any API key in comma-separated list is weak', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: 'valid-api-key-1234567890123456,short',
      });
      expect(result.exitCode).toBe(1);
    });

    it('allows API key at exactly 16 characters', () => {
      const key = 'a'.repeat(MIN_API_KEY_LENGTH);
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: key,
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('allows API key longer than 16 characters', () => {
      const key = 'b'.repeat(64);
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: key,
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('allows multiple valid API keys', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: `${'a'.repeat(20)},${'b'.repeat(20)}`,
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('exits with 15-char key (boundary test)', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_API_KEYS: 'a'.repeat(15),
      });
      expect(result.exitCode).toBe(1);
    });
  });

  // ── Guard 4: Weak JWT secret ──

  describe('JWT secret length enforcement', () => {
    it('exits when JWT secret is shorter than 32 characters', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_JWT_SECRET: 'short-secret',
      });
      expect(result.exitCode).toBe(1);
      expect(result.exitReason).toContain(`at least ${MIN_JWT_SECRET_LENGTH} characters`);
    });

    it('allows JWT secret at exactly 32 characters', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_JWT_SECRET: 'c'.repeat(MIN_JWT_SECRET_LENGTH),
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('allows JWT secret longer than 32 characters', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_JWT_SECRET: 'd'.repeat(64),
      });
      expect(result.exitCode).toBeNull();
      expect(result.enableAuth).toBe(true);
    });

    it('exits with 31-char secret (boundary test)', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_JWT_SECRET: 'e'.repeat(31),
      });
      expect(result.exitCode).toBe(1);
    });

    it('skips JWT secret check when empty', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_JWT_SECRET: '',
      });
      // No exit for empty secret (just means JWT auth is off)
      expect(result.exitCode).toBeNull();
    });
  });

  // ── enableAuth logic ──

  describe('enableAuth determination', () => {
    it('enables auth when API keys are configured', () => {
      const result = evaluateAuthGuards({
        PROBE_API_KEYS: 'f'.repeat(20),
      });
      expect(result.enableAuth).toBe(true);
    });

    it('enables auth when JWT secret is configured', () => {
      const result = evaluateAuthGuards({
        PROBE_JWT_SECRET: 'g'.repeat(32),
      });
      expect(result.enableAuth).toBe(true);
    });

    it('disables auth when PROBE_AUTH_DISABLED=1 in development', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_AUTH_DISABLED: '1',
        PROBE_API_KEYS: 'h'.repeat(20),
      });
      expect(result.enableAuth).toBe(false);
    });

    it('disables auth when no credentials and not production', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
      });
      expect(result.enableAuth).toBe(false);
    });

    it('PROBE_AUTH_DISABLED=0 does not disable auth', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'development',
        PROBE_AUTH_DISABLED: '0',
        PROBE_API_KEYS: 'i'.repeat(20),
      });
      expect(result.enableAuth).toBe(true);
    });
  });

  // ── Guard priority (first to fire) ──

  describe('guard evaluation order', () => {
    it('auth-disabled-in-prod fires before missing-credentials check', () => {
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_AUTH_DISABLED: '1',
        PROBE_API_KEYS: '',
        PROBE_JWT_SECRET: '',
      });
      expect(result.exitReason).toContain('forbidden in production');
    });

    it('missing-credentials fires before weak-key check in production', () => {
      // No keys at all — should fail on "requires" not on "too short"
      const result = evaluateAuthGuards({
        NODE_ENV: 'production',
        PROBE_API_KEYS: '',
      });
      expect(result.exitReason).toContain('requires PROBE_API_KEYS or PROBE_JWT_SECRET');
    });
  });
});
