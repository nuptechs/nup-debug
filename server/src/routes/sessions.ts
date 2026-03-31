// ============================================================
// Sessions REST API — CRUD for debug sessions
// ============================================================

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { SessionConfig } from '@probe/core';
import { generateSessionId } from '@probe/core';
import { z } from 'zod';
import type { SessionManager } from '../services/session-manager.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { logger } from '../logger.js';

export const sessionsRouter = Router();

// ---- Schemas ----

const createSessionSchema = z.object({
  name: z.string().max(256).regex(/^[\w\s\-.:()[\]]+$/, 'Invalid session name characters').optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string().max(64)).max(20).optional(),
}).strict().optional();

const listSessionsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.string().max(32).optional(),
  search: z.string().max(256).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['idle', 'capturing', 'paused', 'completed', 'error']),
});

function getManager(req: Request): SessionManager {
  return req.app.locals['sessionManager'] as SessionManager;
}

// POST /api/sessions — Create new debug session
sessionsRouter.post('/', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const body = parsed.data;
  const name = body?.name ?? `session-${generateSessionId().slice(0, 8)}`;
  const config = (body?.config ?? {}) as SessionConfig;
  const tags = body?.tags;

  const session = await manager.createSession(name, config, tags);
  logger.info({ audit: 'session.create', sessionId: session.id, name, ip: req.ip }, 'Session created');
  res.status(201).json(session);
}));

// GET /api/sessions — List all sessions (with pagination)
sessionsRouter.get('/', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const parsed = listSessionsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const { limit, offset, status, search } = parsed.data;
  const result = await manager.listSessionsPaginated({ limit, offset, status, search });
  res.json(result);
}));

// GET /api/sessions/:id — Get session details
sessionsRouter.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const session = await manager.getSession(req.params['id'] as string);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json(session);
}));

// DELETE /api/sessions/:id — Delete session
sessionsRouter.delete('/:id', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const sessionId = req.params['id'] as string;
  const deleted = await manager.deleteSession(sessionId);

  if (!deleted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  logger.warn({ audit: 'session.delete', sessionId, ip: req.ip }, 'Session deleted');
  res.status(204).send();
}));

// PATCH /api/sessions/:id/status — Update session status
sessionsRouter.patch('/:id/status', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const parsed = updateStatusSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: `Invalid status. Must be one of: idle, capturing, paused, completed, error`,
      details: parsed.error.issues,
    });
    return;
  }

  const session = await manager.updateSessionStatus(req.params['id'] as string, parsed.data.status);

  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  logger.info({ audit: 'session.statusChange', sessionId: req.params['id'], newStatus: parsed.data.status, ip: req.ip }, 'Session status updated');
  res.json(session);
}));
