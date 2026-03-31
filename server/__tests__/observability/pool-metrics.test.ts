// ============================================================
// R19 Pool Metrics Tests — Validate PostgreSQL pool metric collection
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InstrumentedStorage, instrumentStorage } from '../../src/lib/instrumented-storage.js';
import { StoragePort } from '@probe/core';
import type { DebugSession, ProbeEvent } from '@probe/core';
import type { EventFilter, PoolStats } from '@probe/core';
import {
  resetMetrics,
  pgPoolTotalConnections,
  pgPoolIdleConnections,
  pgPoolWaitingClients,
  pgPoolMaxConnections,
  pgCircuitBreakerState,
} from '../../src/lib/metrics.js';

// Minimal StoragePort stub that exposes pool stats
class FakePostgresStorage extends StoragePort {
  private stats: PoolStats | null;

  constructor(stats: PoolStats | null = null) {
    super();
    this.stats = stats;
  }

  setStats(s: PoolStats | null) { this.stats = s; }

  override getPoolStats(): PoolStats | null { return this.stats; }

  async saveSession(_s: DebugSession): Promise<void> {}
  async loadSession(_id: string): Promise<DebugSession | null> { return null; }
  async listSessions(): Promise<DebugSession[]> { return []; }
  async deleteSession(_id: string): Promise<void> {}
  async updateSessionStatus(): Promise<void> {}
  async appendEvent(): Promise<void> {}
  async appendEvents(): Promise<void> {}
  async getEvents(_sid: string, _f?: EventFilter): Promise<ProbeEvent[]> { return []; }
  async getEventCount(): Promise<number> { return 0; }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {}
}

describe('Pool Metrics Collection (InstrumentedStorage)', () => {
  let fakeStorage: FakePostgresStorage;
  let instrumented: InstrumentedStorage;

  beforeEach(() => {
    resetMetrics();
    fakeStorage = new FakePostgresStorage({
      totalCount: 8,
      idleCount: 5,
      waitingCount: 2,
      maxConnections: 20,
      circuitBreakerState: 'closed',
    });
    instrumented = instrumentStorage(fakeStorage, 'postgres');
  });

  it('getPoolStats delegates to inner storage', () => {
    const stats = instrumented.getPoolStats();
    expect(stats).not.toBeNull();
    expect(stats!.totalCount).toBe(8);
    expect(stats!.idleCount).toBe(5);
    expect(stats!.waitingCount).toBe(2);
    expect(stats!.maxConnections).toBe(20);
    expect(stats!.circuitBreakerState).toBe('closed');
  });

  it('returns null when inner storage has no pool', () => {
    const memoryStorage = new FakePostgresStorage(null);
    const inst = instrumentStorage(memoryStorage, 'memory');
    expect(inst.getPoolStats()).toBeNull();
  });

  it('collectPoolStats updates Prometheus gauges', async () => {
    // Trigger one collection cycle
    instrumented.startPoolStatsCollection();
    instrumented.stopPoolStatsCollection();

    const total = await pgPoolTotalConnections.get();
    const idle = await pgPoolIdleConnections.get();
    const waiting = await pgPoolWaitingClients.get();
    const max = await pgPoolMaxConnections.get();
    const cbState = await pgCircuitBreakerState.get();

    expect(total.values[0]?.value).toBe(8);
    expect(idle.values[0]?.value).toBe(5);
    expect(waiting.values[0]?.value).toBe(2);
    expect(max.values[0]?.value).toBe(20);
    expect(cbState.values[0]?.value).toBe(0); // closed = 0
  });

  it('maps circuit breaker states correctly', async () => {
    // half-open = 1
    fakeStorage.setStats({
      totalCount: 3,
      idleCount: 0,
      waitingCount: 10,
      maxConnections: 20,
      circuitBreakerState: 'half-open',
    });
    instrumented.startPoolStatsCollection();
    instrumented.stopPoolStatsCollection();

    let cbState = await pgCircuitBreakerState.get();
    expect(cbState.values[0]?.value).toBe(1);

    // open = 2
    resetMetrics();
    fakeStorage.setStats({
      totalCount: 0,
      idleCount: 0,
      waitingCount: 20,
      maxConnections: 20,
      circuitBreakerState: 'open',
    });
    instrumented.startPoolStatsCollection();
    instrumented.stopPoolStatsCollection();

    cbState = await pgCircuitBreakerState.get();
    expect(cbState.values[0]?.value).toBe(2);
  });

  it('does nothing when inner storage returns null pool stats', async () => {
    const memInst = instrumentStorage(new FakePostgresStorage(null), 'memory');
    memInst.startPoolStatsCollection();
    memInst.stopPoolStatsCollection();

    const total = await pgPoolTotalConnections.get();
    // Gauge may retain a 0 entry from prior reset; the key check is no real value was set
    const value = total.values[0]?.value ?? 0;
    expect(value).toBe(0);
  });

  it('stopPoolStatsCollection is idempotent', () => {
    instrumented.stopPoolStatsCollection();
    instrumented.stopPoolStatsCollection(); // Should not throw
  });

  it('startPoolStatsCollection is idempotent', () => {
    instrumented.startPoolStatsCollection();
    instrumented.startPoolStatsCollection(); // Should not create duplicate interval
    instrumented.stopPoolStatsCollection();
  });
});
