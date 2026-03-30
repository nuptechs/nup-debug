// ============================================================
// MySQL Query Interceptor — Wraps mysql2 pool.query/execute
// Emits SdkDbQueryEvent with timing, row counts, errors
// ============================================================

import type { SdkDbQueryEvent } from '@probe/core';
import { nowMs } from '@probe/core';
import { getCurrentRequestId, getCurrentCorrelationId } from './context.js';

const MAX_QUERY_LENGTH = 1000;

export interface MySqlInterceptorConfig {
  emitEvent: (event: Omit<SdkDbQueryEvent, 'id' | 'sessionId' | 'timestamp' | 'source'>) => void;
  sessionId: string;
  redactParams?: boolean; // default true
}

/** WeakMap storing original methods per pool instance */
const originals = new WeakMap<object, { query: Function; execute: Function }>();

/**
 * Wrap a mysql2-compatible Pool to intercept query and execute calls.
 * Monkey-patches pool.query and pool.execute to capture timing and emit events.
 * Returns the same pool instance (mutated).
 */
export function wrapMysqlPool(pool: any, config: MySqlInterceptorConfig): any {
  if (originals.has(pool)) return pool; // already wrapped

  const originalQuery = pool.query.bind(pool);
  const originalExecute = pool.execute?.bind(pool);

  originals.set(pool, {
    query: originalQuery,
    execute: originalExecute ?? originalQuery,
  });

  const redact = config.redactParams !== false; // default true

  pool.query = function probeWrappedQuery(...args: unknown[]): unknown {
    return interceptCall(originalQuery, args, config, redact);
  };

  if (originalExecute) {
    pool.execute = function probeWrappedExecute(...args: unknown[]): unknown {
      return interceptCall(originalExecute, args, config, redact);
    };
  }

  return pool;
}

/**
 * Remove instrumentation from a mysql2 pool, restoring original methods.
 */
export function unwrapMysqlPool(pool: any): void {
  const saved = originals.get(pool);
  if (!saved) return;

  pool.query = saved.query;
  if (saved.execute) pool.execute = saved.execute;
  originals.delete(pool);
}

// ---- Internal helpers ----

function interceptCall(
  original: Function,
  args: unknown[],
  config: MySqlInterceptorConfig,
  redact: boolean,
): unknown {
  const startTime = nowMs();
  const queryText = extractQueryText(args);
  const callback = extractCallback(args);

  // Callback-style: pool.query(sql, params, cb) or pool.query(sql, cb)
  if (callback) {
    const cbIndex = args.indexOf(callback);
    args[cbIndex] = function wrappedCallback(err: unknown, results: unknown, fields: unknown) {
      const duration = nowMs() - startTime;
      emitMysqlEvent(config, {
        query: normalizeAndTruncate(queryText, redact),
        duration,
        rowCount: extractRowCount(results),
        error: err instanceof Error ? err.message : err ? String(err) : undefined,
      });
      callback(err, results, fields);
    };
    return original(...args);
  }

  // Promise-style
  const resultPromise = original(...args);

  if (resultPromise && typeof resultPromise.then === 'function') {
    return resultPromise.then(
      (result: unknown) => {
        const duration = nowMs() - startTime;
        emitMysqlEvent(config, {
          query: normalizeAndTruncate(queryText, redact),
          duration,
          rowCount: extractRowCount(result),
        });
        return result;
      },
      (err: unknown) => {
        const duration = nowMs() - startTime;
        emitMysqlEvent(config, {
          query: normalizeAndTruncate(queryText, redact),
          duration,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      },
    );
  }

  return resultPromise;
}

function emitMysqlEvent(
  config: MySqlInterceptorConfig,
  data: {
    query: string;
    duration: number;
    rowCount?: number;
    error?: string;
  },
): void {
  config.emitEvent({
    type: 'db-query' as const,
    correlationId: getCurrentCorrelationId() ?? '',
    query: data.query,
    duration: data.duration,
    rowCount: data.rowCount,
    error: data.error,
    requestId: getCurrentRequestId(),
  } as any);
}

function extractQueryText(args: unknown[]): string {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first && typeof first === 'object' && 'sql' in first) {
    return String((first as { sql: unknown }).sql);
  }
  return '[unknown query]';
}

function extractCallback(args: unknown[]): Function | undefined {
  for (let i = args.length - 1; i >= 0; i--) {
    if (typeof args[i] === 'function') return args[i] as Function;
  }
  return undefined;
}

function extractRowCount(result: unknown): number | undefined {
  if (!result) return undefined;
  // mysql2 returns [rows, fields] for promise API
  if (Array.isArray(result) && result.length >= 1) {
    const rows = result[0];
    if (Array.isArray(rows)) return rows.length;
    // For INSERT/UPDATE/DELETE, result[0] has affectedRows
    if (rows && typeof rows === 'object' && 'affectedRows' in rows) {
      return (rows as { affectedRows: number }).affectedRows;
    }
  }
  // Callback-style passes rows directly
  if (Array.isArray(result)) return result.length;
  if (result && typeof result === 'object' && 'affectedRows' in result) {
    return (result as { affectedRows: number }).affectedRows;
  }
  return undefined;
}

/** Normalize query: collapse whitespace, trim, redact string literals */
function normalizeAndTruncate(query: string, redact: boolean): string {
  let normalized = query.replace(/\s+/g, ' ').trim();
  if (redact) {
    // Replace string literals with placeholders
    normalized = normalized.replace(/'[^']*'/g, '?');
    // Replace numeric literals (not part of identifiers)
    normalized = normalized.replace(/\b\d+\.?\d*\b/g, (match, offset: number) => {
      if (offset > 0 && normalized[offset - 1] === '`') return match;
      return '?';
    });
  }
  if (normalized.length > MAX_QUERY_LENGTH) {
    return normalized.slice(0, MAX_QUERY_LENGTH) + '... [truncated]';
  }
  return normalized;
}
