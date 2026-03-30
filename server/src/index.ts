// ============================================================
// @probe/server — Express + WebSocket server entry point
// ============================================================

import { createServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { sessionsRouter } from './routes/sessions.js';
import { eventsRouter } from './routes/events.js';
import { reportsRouter } from './routes/reports.js';
import { SessionManager } from './services/session-manager.js';
import { setupWebSocket } from './ws/realtime.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rate-limiter.js';

const PORT = parseInt(process.env['PORT'] ?? '7070', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

const app = express();

// Health check (before auth/rate-limit)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});
app.get('/ready', (_req, res) => {
  res.json({ status: 'ready' });
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Rate limiter: 200 req/s sustained, 500 burst per IP
app.use(createRateLimiter({ maxRequests: 200, windowMs: 1000, burstSize: 500 }));

// Authentication (disable via PROBE_AUTH_DISABLED=1 for development)
const apiKeys = process.env['PROBE_API_KEYS']?.split(',').filter(Boolean) ?? [];
const jwtSecret = process.env['PROBE_JWT_SECRET'] ?? '';
const enableAuth = process.env['PROBE_AUTH_DISABLED'] !== '1' && (apiKeys.length > 0 || jwtSecret.length > 0);
app.use(createAuthMiddleware({ apiKeys, jwtSecret, enableAuth }));

// Shared session manager
const sessionManager = new SessionManager();

// Mount routes — pass session manager via app.locals
app.locals['sessionManager'] = sessionManager;
app.use('/api/sessions', sessionsRouter);
app.use('/api/sessions', eventsRouter);
app.use('/api/sessions', reportsRouter);

// Create HTTP server & attach WebSocket
const server = createServer(app);
setupWebSocket(server, sessionManager);

server.listen(PORT, HOST, () => {
  console.log(`[probe-server] Listening on http://${HOST}:${PORT}`);
  console.log(`[probe-server] WebSocket available on ws://${HOST}:${PORT}`);
  console.log(`[probe-server] Auth: ${enableAuth ? 'enabled' : 'disabled (dev mode)'}`);
});

// Graceful shutdown
const shutdown = (): void => {
  console.log('\n[probe-server] Shutting down...');
  sessionManager.destroy();
  server.close(() => {
    console.log('[probe-server] Closed.');
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000).unref();
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server };
