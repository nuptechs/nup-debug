// ============================================================
// WebhookEventStore — Persistence contract for webhook deliveries
// Used by WebhookNotificationAdapter when persistence is enabled.
// Default impl: in-memory. Consumers can plug in custom stores (e.g. SQL-backed).
// ============================================================

import type { WebhookEvent, WebhookEventStatus } from './types.js';

export interface WebhookEventListFilter {
  status?: WebhookEventStatus;
  limit?: number;
  offset?: number;
}

export abstract class WebhookEventStore {
  abstract create(event: WebhookEvent): Promise<WebhookEvent>;
  abstract get(id: string): Promise<WebhookEvent | null>;
  abstract update(id: string, patch: Partial<WebhookEvent>): Promise<WebhookEvent | null>;
  abstract list(filter?: WebhookEventListFilter): Promise<WebhookEvent[]>;
}

export class InMemoryWebhookEventStore extends WebhookEventStore {
  private static readonly DEFAULT_LIMIT = 50;
  private static readonly MAX_LIMIT = 500;
  private readonly events = new Map<string, WebhookEvent>();

  async create(event: WebhookEvent): Promise<WebhookEvent> {
    const cloned = structuredClone(event);
    this.events.set(cloned.id, cloned);
    return structuredClone(cloned);
  }

  async get(id: string): Promise<WebhookEvent | null> {
    const found = this.events.get(id);
    return found ? structuredClone(found) : null;
  }

  async update(id: string, patch: Partial<WebhookEvent>): Promise<WebhookEvent | null> {
    const existing = this.events.get(id);
    if (!existing) return null;
    const merged = { ...existing, ...patch, id: existing.id } as WebhookEvent;
    this.events.set(id, merged);
    return structuredClone(merged);
  }

  async list(filter: WebhookEventListFilter = {}): Promise<WebhookEvent[]> {
    let out = [...this.events.values()];
    if (filter.status) {
      out = out.filter((e) => e.status === filter.status);
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = filter.offset ?? 0;
    const limit = Math.min(
      filter.limit ?? InMemoryWebhookEventStore.DEFAULT_LIMIT,
      InMemoryWebhookEventStore.MAX_LIMIT,
    );
    return out.slice(offset, offset + limit).map((e) => structuredClone(e));
  }
}
