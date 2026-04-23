// ============================================================
// PostgresWebhookEventStore — WebhookEventStore backed by pg.
// Creates its own `probe_webhook_events` table idempotently.
// Concurrent-safe via advisory lock during migration.
// ============================================================

import type { WebhookEvent, WebhookEventStatus } from './types.js';
import { WebhookEventStore, type WebhookEventListFilter } from './webhook-event-store.js';

// pg types — dynamically imported (optional dependency)
type Pool = import('pg').Pool;
type PoolConfig = import('pg').PoolConfig;

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS probe_webhook_events (
    id            TEXT PRIMARY KEY,
    target_url    TEXT NOT NULL,
    event         TEXT NOT NULL,
    payload       JSONB NOT NULL,
    status        TEXT NOT NULL,
    attempts      INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TIMESTAMPTZ,
    error_message TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_probe_webhook_events_status_created
    ON probe_webhook_events (status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_probe_webhook_events_created
    ON probe_webhook_events (created_at DESC);
`;

/** Advisory lock id for webhook schema init — arbitrary but unique. */
const MIGRATION_LOCK_ID = 7364824;

export interface PostgresWebhookEventStoreConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  maxConnections?: number;
  /** Reuse an existing pg.Pool instead of creating one. */
  pool?: Pool;
}

interface Row {
  id: string;
  target_url: string;
  event: string;
  payload: unknown;
  status: string;
  attempts: number;
  last_attempt_at: Date | null;
  error_message: string | null;
  created_at: Date;
}

function rowToEvent(row: Row): WebhookEvent {
  return {
    id: row.id,
    targetUrl: row.target_url,
    event: row.event,
    payload: row.payload,
    status: row.status as WebhookEventStatus,
    attempts: Number(row.attempts),
    lastAttemptAt: row.last_attempt_at ? row.last_attempt_at.toISOString() : null,
    errorMessage: row.error_message,
    createdAt: row.created_at.toISOString(),
  };
}

/** Default limit/cap mirror InMemoryWebhookEventStore for drop-in parity. */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export class PostgresWebhookEventStore extends WebhookEventStore {
  private pool: Pool | null = null;
  private readonly config: PostgresWebhookEventStoreConfig;
  private readonly ownsPool: boolean;
  private initialized = false;

  constructor(config: PostgresWebhookEventStoreConfig) {
    super();
    this.config = config;
    this.ownsPool = !config.pool;
    this.pool = config.pool ?? null;
  }

  /** Idempotent — safe to call once at startup. */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!this.pool) {
      const { default: pg } = await import('pg');
      const poolConfig: PoolConfig = {
        max: this.config.maxConnections ?? 5,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 30_000,
        query_timeout: 30_000,
      } as PoolConfig;

      if (this.config.connectionString) {
        poolConfig.connectionString = this.config.connectionString;
      } else {
        poolConfig.host = this.config.host ?? 'localhost';
        poolConfig.port = this.config.port ?? 5432;
        poolConfig.database = this.config.database ?? 'debug_probe';
        poolConfig.user = this.config.user ?? 'probe';
        poolConfig.password = this.config.password;
      }
      if (this.config.ssl) {
        poolConfig.ssl =
          typeof this.config.ssl === 'object' ? this.config.ssl : { rejectUnauthorized: true };
      }
      this.pool = new pg.Pool(poolConfig);
    }

    const client = await this.pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
      try {
        await client.query(SCHEMA_SQL);
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]);
      }
    } finally {
      client.release();
    }
    this.initialized = true;
  }

  async close(): Promise<void> {
    if (this.pool && this.ownsPool) {
      await this.pool.end();
    }
    this.pool = null;
    this.initialized = false;
  }

  private getPool(): Pool {
    if (!this.pool || !this.initialized) {
      throw new Error('PostgresWebhookEventStore not initialized — call initialize() first');
    }
    return this.pool;
  }

  async create(event: WebhookEvent): Promise<WebhookEvent> {
    const pool = this.getPool();
    const { rows } = await pool.query<Row>(
      `INSERT INTO probe_webhook_events (
         id, target_url, event, payload, status, attempts, last_attempt_at, error_message, created_at
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        event.id,
        event.targetUrl,
        event.event,
        JSON.stringify(event.payload ?? null),
        event.status,
        event.attempts,
        event.lastAttemptAt ? new Date(event.lastAttemptAt) : null,
        event.errorMessage,
        event.createdAt ? new Date(event.createdAt) : new Date(),
      ],
    );
    const row = rows[0];
    if (!row) throw new Error('create returned no row');
    return rowToEvent(row);
  }

  async get(id: string): Promise<WebhookEvent | null> {
    const pool = this.getPool();
    const { rows } = await pool.query<Row>(
      'SELECT * FROM probe_webhook_events WHERE id = $1',
      [id],
    );
    const row = rows[0];
    return row ? rowToEvent(row) : null;
  }

  async update(id: string, patch: Partial<WebhookEvent>): Promise<WebhookEvent | null> {
    const pool = this.getPool();
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    const push = (col: string, val: unknown): void => {
      sets.push(`${col} = $${idx++}`);
      params.push(val);
    };

    if (patch.status !== undefined) push('status', patch.status);
    if (patch.attempts !== undefined) push('attempts', patch.attempts);
    if (patch.lastAttemptAt !== undefined) {
      push('last_attempt_at', patch.lastAttemptAt ? new Date(patch.lastAttemptAt) : null);
    }
    if (patch.errorMessage !== undefined) push('error_message', patch.errorMessage);
    if (patch.payload !== undefined) {
      sets.push(`payload = $${idx++}::jsonb`);
      params.push(JSON.stringify(patch.payload ?? null));
    }
    if (patch.targetUrl !== undefined) push('target_url', patch.targetUrl);
    if (patch.event !== undefined) push('event', patch.event);

    if (sets.length === 0) {
      return this.get(id);
    }

    params.push(id);
    const sql = `UPDATE probe_webhook_events SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`;
    const { rows } = await pool.query<Row>(sql, params);
    const row = rows[0];
    return row ? rowToEvent(row) : null;
  }

  async list(filter: WebhookEventListFilter = {}): Promise<WebhookEvent[]> {
    const pool = this.getPool();
    const limit = Math.min(filter.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = filter.offset ?? 0;

    if (filter.status) {
      const { rows } = await pool.query<Row>(
        `SELECT * FROM probe_webhook_events
         WHERE status = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [filter.status, limit, offset],
      );
      return rows.map(rowToEvent);
    }

    const { rows } = await pool.query<Row>(
      `SELECT * FROM probe_webhook_events
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
    return rows.map(rowToEvent);
  }

  /**
   * Return unfinished deliveries (pending | failed) so callers can resume
   * retries after a restart. Dead-lettered and successful events are excluded.
   */
  async listUnfinished(limit = 500): Promise<WebhookEvent[]> {
    const pool = this.getPool();
    const capped = Math.min(Math.max(limit, 1), MAX_LIMIT * 2);
    const { rows } = await pool.query<Row>(
      `SELECT * FROM probe_webhook_events
       WHERE status IN ('pending', 'failed')
       ORDER BY created_at ASC
       LIMIT $1`,
      [capped],
    );
    return rows.map(rowToEvent);
  }
}
