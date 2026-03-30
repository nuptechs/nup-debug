// ============================================================
// MemoryStorageAdapter — Comprehensive tests
// ============================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { MemoryStorageAdapter } from '../../src/storage/memory-storage.adapter.js';
import type { DebugSession, ProbeEvent } from '../../src/types/index.js';

function makeSession(id = 'sess-1'): DebugSession {
  return {
    id,
    name: 'Test Session',
    status: 'idle',
    config: {
      browser: { enabled: true, captureClicks: true, captureNavigation: true, captureConsole: true, captureErrors: true },
      logs: { enabled: true, sources: [] },
      network: { enabled: false },
      sdk: { enabled: false },
      correlation: { enabled: true, strategies: ['request-id'], maxGroupAge: 60000 },
      capture: { maxEvents: 10000, maxDuration: 300000 },
    },
    startedAt: 1000,
    eventCount: 0,
  };
}

function makeEvent(sessionId: string, source = 'browser', timestamp = Date.now()): ProbeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    sessionId,
    timestamp,
    source,
    correlationId: 'corr-1',
  } as ProbeEvent;
}

describe('MemoryStorageAdapter', () => {
  let storage: MemoryStorageAdapter;

  beforeEach(async () => {
    storage = new MemoryStorageAdapter();
    await storage.initialize();
  });

  describe('session CRUD', () => {
    it('saves and loads a session', async () => {
      const session = makeSession();
      await storage.saveSession(session);
      const loaded = await storage.loadSession('sess-1');
      expect(loaded).toEqual(session);
    });

    it('returns null for unknown session', async () => {
      expect(await storage.loadSession('nope')).toBeNull();
    });

    it('returns isolation (no mutation leaks)', async () => {
      const session = makeSession();
      await storage.saveSession(session);
      const loaded = await storage.loadSession('sess-1');
      loaded!.name = 'CHANGED';
      const reloaded = await storage.loadSession('sess-1');
      expect(reloaded!.name).toBe('Test Session');
    });

    it('lists all sessions', async () => {
      await storage.saveSession(makeSession('a'));
      await storage.saveSession(makeSession('b'));
      const all = await storage.listSessions();
      expect(all).toHaveLength(2);
    });

    it('deletes a session', async () => {
      await storage.saveSession(makeSession());
      await storage.deleteSession('sess-1');
      expect(await storage.loadSession('sess-1')).toBeNull();
    });

    it('updates session status', async () => {
      await storage.saveSession(makeSession());
      await storage.updateSessionStatus('sess-1', 'capturing');
      const loaded = await storage.loadSession('sess-1');
      expect(loaded!.status).toBe('capturing');
    });

    it('throws on status update for unknown session', async () => {
      await expect(storage.updateSessionStatus('nope', 'capturing')).rejects.toThrow();
    });
  });

  describe('event storage', () => {
    beforeEach(async () => {
      await storage.saveSession(makeSession());
    });

    it('appends and retrieves events', async () => {
      const event = makeEvent('sess-1');
      await storage.appendEvent('sess-1', event);
      const events = await storage.getEvents('sess-1');
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe(event.id);
    });

    it('appends multiple events', async () => {
      const events = [makeEvent('sess-1'), makeEvent('sess-1'), makeEvent('sess-1')];
      await storage.appendEvents('sess-1', events);
      expect(await storage.getEventCount('sess-1')).toBe(3);
    });

    it('filters by source', async () => {
      await storage.appendEvent('sess-1', makeEvent('sess-1', 'browser'));
      await storage.appendEvent('sess-1', makeEvent('sess-1', 'network'));
      const filtered = await storage.getEvents('sess-1', { source: ['browser'] });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].source).toBe('browser');
    });

    it('filters by time range', async () => {
      await storage.appendEvent('sess-1', makeEvent('sess-1', 'browser', 100));
      await storage.appendEvent('sess-1', makeEvent('sess-1', 'browser', 200));
      await storage.appendEvent('sess-1', makeEvent('sess-1', 'browser', 300));
      const filtered = await storage.getEvents('sess-1', { fromTime: 150, toTime: 250 });
      expect(filtered).toHaveLength(1);
    });

    it('applies limit and offset', async () => {
      for (let i = 0; i < 10; i++) {
        await storage.appendEvent('sess-1', makeEvent('sess-1'));
      }
      const page = await storage.getEvents('sess-1', { limit: 3, offset: 2 });
      expect(page).toHaveLength(3);
    });

    it('returns 0 count for unknown session', async () => {
      expect(await storage.getEventCount('nope')).toBe(0);
    });

    it('returns empty array for unknown session events', async () => {
      expect(await storage.getEvents('nope')).toEqual([]);
    });
  });
});
