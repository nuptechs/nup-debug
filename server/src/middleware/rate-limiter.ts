// ============================================================
// Token-bucket rate limiter — in-memory, per-IP
// ============================================================

import type { Request, Response, NextFunction, RequestHandler } from 'express';

// ── Types ────────────────────────────────────────────────────

export interface RateLimiterConfig {
  /** Maximum sustained requests per window */
  maxRequests: number;
  /** Window duration in milliseconds */
  windowMs: number;
  /** Burst capacity (defaults to maxRequests) */
  burstSize?: number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

// ── Constants ────────────────────────────────────────────────

const HEALTH_PATHS = new Set(['/health', '/ready']);
const CLEANUP_INTERVAL_MS = 60_000;

// ── Public: middleware factory ────────────────────────────────

export function createRateLimiter(config: RateLimiterConfig): RequestHandler {
  const { maxRequests, windowMs } = config;
  const burstSize = config.burstSize ?? maxRequests;

  // Token refill rate: tokens per millisecond
  const refillRate = maxRequests / windowMs;

  const buckets = new Map<string, Bucket>();

  // Periodic cleanup of stale entries (buckets not seen for 2× window)
  const staleThreshold = windowMs * 2;
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of buckets) {
      if (now - bucket.lastRefill > staleThreshold) {
        buckets.delete(ip);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanup.unref();

  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting for health checks
    if (HEALTH_PATHS.has(req.path)) {
      next();
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const now = Date.now();

    let bucket = buckets.get(ip);

    if (!bucket) {
      // First request from this IP — start with full burst capacity
      bucket = { tokens: burstSize, lastRefill: now };
      buckets.set(ip, bucket);
    } else {
      // Refill tokens based on elapsed time
      const elapsed = now - bucket.lastRefill;
      const refill = elapsed * refillRate;
      bucket.tokens = Math.min(burstSize, bucket.tokens + refill);
      bucket.lastRefill = now;
    }

    if (bucket.tokens >= 1) {
      // Consume one token and allow the request
      bucket.tokens -= 1;
      next();
    } else {
      // Calculate how long until one token is available
      const waitMs = (1 - bucket.tokens) / refillRate;
      const retryAfter = Math.ceil(waitMs / 1000);

      res.set('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too Many Requests',
        retryAfter,
      });
    }
  };
}
