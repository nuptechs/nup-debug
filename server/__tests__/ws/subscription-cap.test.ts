// ============================================================
// WebSocket Subscription Cap — Tests for MAX_SUBSCRIPTIONS_PER_CLIENT
// Ensures the 51st subscription is rejected
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { setupWebSocket } from '../../src/ws/realtime.js';

const MAX_SUBSCRIPTIONS = 50;
// Rate limit is 20 msgs/sec — we must pause between batches
const BATCH_SIZE = 18;
const BATCH_PAUSE_MS = 1100;

// ── Helpers ───────────────────────────────────────────────────

function createMockSessionManager() {
  const listeners: Array<(sessionId: string, events: any[]) => void> = [];
  return {
    onEventsIngested: vi.fn((listener: any) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    }),
    _emit(sessionId: string, events: any[]) {
      for (const l of listeners) l(sessionId, events);
    },
  };
}

function startServer(): Promise<{ server: http.Server; wss: WebSocketServer; port: number }> {
  return new Promise((resolve) => {
    const server = http.createServer();
    const manager = createMockSessionManager();
    const wss = setupWebSocket(server, manager as any);
    server.listen(0, () => {
      const addr = server.address() as { port: number };
      resolve({ server, wss, port: addr.port });
    });
  });
}

function connectWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (data) => resolve(JSON.parse(data.toString())));
  });
}

async function subscribeAndWait(ws: WebSocket, sessionId: string): Promise<any> {
  ws.send(JSON.stringify({ type: 'subscribe', sessionId }));
  return waitForMessage(ws);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Subscribe to N sessions, pausing between batches to respect rate limiter */
async function subscribeBatch(ws: WebSocket, count: number, prefix = 'session'): Promise<void> {
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % BATCH_SIZE === 0) await sleep(BATCH_PAUSE_MS);
    const msg = await subscribeAndWait(ws, `${prefix}-${i}`);
    expect(msg.type).toBe('subscribed');
  }
}

// ── Tests ─────────────────────────────────────────────────────

describe('WebSocket subscription cap', () => {
  let server: http.Server;
  let wss: WebSocketServer;
  let port: number;

  beforeEach(async () => {
    ({ server, wss, port } = await startServer());
  });

  afterEach(async () => {
    wss?.close();
    await new Promise<void>((r) => server?.close(() => r()));
  });

  it(`allows up to ${MAX_SUBSCRIPTIONS} subscriptions`, async () => {
    const ws = await connectWs(port);
    await subscribeBatch(ws, MAX_SUBSCRIPTIONS);
    ws.close();
  }, 30_000);

  it(`rejects the ${MAX_SUBSCRIPTIONS + 1}th subscription`, async () => {
    const ws = await connectWs(port);
    await subscribeBatch(ws, MAX_SUBSCRIPTIONS);

    // Wait for rate limit window to reset before sending 51st
    await sleep(BATCH_PAUSE_MS);

    const reject = await subscribeAndWait(ws, 'session-overflow');
    expect(reject.type).toBe('error');
    expect(reject.message).toContain(`Max ${MAX_SUBSCRIPTIONS}`);

    ws.close();
  }, 30_000);

  it('allows new subscriptions after unsubscribing', async () => {
    const ws = await connectWs(port);
    await subscribeBatch(ws, MAX_SUBSCRIPTIONS);

    await sleep(BATCH_PAUSE_MS);

    // Unsubscribe one
    ws.send(JSON.stringify({ type: 'unsubscribe', sessionId: 'session-0' }));
    const unsub = await waitForMessage(ws);
    expect(unsub.type).toBe('unsubscribed');

    // Now we should be able to subscribe again
    const newSub = await subscribeAndWait(ws, 'session-new');
    expect(newSub.type).toBe('subscribed');

    ws.close();
  }, 30_000);

  it('subscription cap is per-client, not global', async () => {
    const ws1 = await connectWs(port);
    const ws2 = await connectWs(port);

    await subscribeBatch(ws1, MAX_SUBSCRIPTIONS, 'ws1-session');

    // ws2 should still be able to subscribe independently
    const msg = await subscribeAndWait(ws2, 'ws2-session-0');
    expect(msg.type).toBe('subscribed');

    ws1.close();
    ws2.close();
  }, 30_000);

  it('duplicate subscriptions do not count toward cap', async () => {
    const ws = await connectWs(port);

    // Subscribe to same session twice — Set deduplicates
    await subscribeAndWait(ws, 'same-session');
    await subscribeAndWait(ws, 'same-session');

    // We should be able to subscribe to MAX - 1 more (since dedupe = only 1 counted)
    for (let i = 1; i < MAX_SUBSCRIPTIONS; i++) {
      if (i > 0 && i % BATCH_SIZE === 0) await sleep(BATCH_PAUSE_MS);
      const msg = await subscribeAndWait(ws, `session-${i}`);
      expect(msg.type).toBe('subscribed');
    }

    ws.close();
  }, 30_000);
});
