// ============================================================
// SessionManager webhook integration — ensures lifecycle events
// are dispatched to the NotificationPort fire-and-forget.
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryStorageAdapter, NotificationPort } from '@probe/core';
import { SessionManager } from '../../src/services/session-manager.js';

interface Capture {
  event: string;
  payload: unknown;
}

class CapturingNotification extends NotificationPort {
  readonly captures: Capture[] = [];
  private configured: boolean;
  constructor(configured = true) {
    super();
    this.configured = configured;
  }
  async notify(event: string, payload: unknown): Promise<boolean> {
    this.captures.push({ event, payload });
    return true;
  }
  isConfigured(): boolean {
    return this.configured;
  }
}

async function flush(): Promise<void> {
  // Allow fire-and-forget promises to settle
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe('SessionManager webhook integration', () => {
  let storage: MemoryStorageAdapter;
  let notification: CapturingNotification;
  let manager: SessionManager;

  beforeEach(async () => {
    storage = new MemoryStorageAdapter();
    await storage.initialize();
    notification = new CapturingNotification();
    manager = new SessionManager(storage, notification);
  });

  afterEach(() => {
    manager.destroy();
  });

  it('emits session.created on createSession', async () => {
    const session = await manager.createSession('webhook-test', {});
    await flush();
    expect(notification.captures).toHaveLength(1);
    const first = notification.captures[0]!;
    expect(first.event).toBe('session.created');
    expect(first.payload).toMatchObject({ sessionId: session.id, name: 'webhook-test' });
  });

  it('emits session.completed on status transition to completed', async () => {
    const session = await manager.createSession('complete-test', {});
    notification.captures.length = 0;
    await manager.updateSessionStatus(session.id, 'completed');
    await flush();
    expect(notification.captures).toHaveLength(1);
    const first = notification.captures[0]!;
    expect(first.event).toBe('session.completed');
    expect(first.payload).toMatchObject({ sessionId: session.id, toStatus: 'completed' });
  });

  it('emits session.error on status transition to error', async () => {
    const session = await manager.createSession('error-test', {});
    notification.captures.length = 0;
    await manager.updateSessionStatus(session.id, 'error');
    await flush();
    expect(notification.captures).toHaveLength(1);
    expect(notification.captures[0]!.event).toBe('session.error');
  });

  it('does NOT emit webhook for non-terminal status transitions', async () => {
    const session = await manager.createSession('capture-test', {});
    notification.captures.length = 0;
    await manager.updateSessionStatus(session.id, 'capturing');
    await manager.updateSessionStatus(session.id, 'paused');
    await flush();
    expect(notification.captures).toHaveLength(0);
  });

  it('emits session.deleted on delete', async () => {
    const session = await manager.createSession('del-test', {});
    notification.captures.length = 0;
    await manager.deleteSession(session.id);
    await flush();
    expect(notification.captures).toHaveLength(1);
    expect(notification.captures[0]!.event).toBe('session.deleted');
  });

  it('does not emit when NotificationPort is unconfigured (noop-like)', async () => {
    const unconfigured = new CapturingNotification(false);
    const storage2 = new MemoryStorageAdapter();
    await storage2.initialize();
    const mgr = new SessionManager(storage2, unconfigured);
    try {
      await mgr.createSession('noop', {});
      await flush();
      expect(unconfigured.captures).toHaveLength(0);
    } finally {
      mgr.destroy();
    }
  });

  it('swallows notify() rejections without breaking domain flow', async () => {
    class FailingNotification extends NotificationPort {
      async notify(): Promise<boolean> {
        throw new Error('boom');
      }
      isConfigured(): boolean {
        return true;
      }
    }
    const storage2 = new MemoryStorageAdapter();
    await storage2.initialize();
    const mgr = new SessionManager(storage2, new FailingNotification());
    try {
      const s = await mgr.createSession('failing', {});
      expect(s.id).toBeDefined();
      await flush();
      // No throw = success
    } finally {
      mgr.destroy();
    }
  });
});
