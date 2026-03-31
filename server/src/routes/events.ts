// ============================================================
// Events REST API — Ingest and query events for a session
// ============================================================

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { ProbeEvent } from '@probe/core';
import { z } from 'zod';
import type { SessionManager } from '../services/session-manager.js';
import { asyncHandler } from '../middleware/async-handler.js';
import { sessionIdSchema } from './sessions.js';

export const eventsRouter = Router();

const MAX_BATCH_SIZE = 1000;
const MAX_EVENT_JSON_SIZE = 256 * 1024; // 256KB per event

// ---- Schemas ----

const eventSchema = z.object({
  id: z.string().min(1).max(128),
  sessionId: z.string().min(1).max(128),
  timestamp: z.number().finite(),
  source: z.enum(['browser', 'network', 'log', 'sdk', 'correlation']),
}).passthrough();

const ingestSchema = z.union([
  z.object({ events: z.array(eventSchema).min(1).max(MAX_BATCH_SIZE) }),
  z.array(eventSchema).min(1).max(MAX_BATCH_SIZE),
]);

const queryEventsSchema = z.object({
  source: z.enum(['browser', 'network', 'log', 'sdk', 'correlation']).optional(),
  type: z.string().max(64).optional(),
  fromTime: z.coerce.number().finite().optional(),
  toTime: z.coerce.number().finite().optional(),
  limit: z.coerce.number().int().min(1).max(10_000).default(500),
  offset: z.coerce.number().int().min(0).default(0),
});

function getManager(req: Request): SessionManager {
  return req.app.locals['sessionManager'] as SessionManager;
}

// POST /api/sessions/:id/events — Ingest events (batch)
eventsRouter.post('/:id/events', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const idResult = sessionIdSchema.safeParse(req.params['id']);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid session ID' }); return; }
  const sessionId = idResult.data;

  const session = await manager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const parsed = ingestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const events: ProbeEvent[] = Array.isArray(parsed.data) ? parsed.data as ProbeEvent[] : (parsed.data.events as ProbeEvent[]);

  // Per-event size check (defense against single oversized events)
  for (const event of events) {
    if (JSON.stringify(event).length > MAX_EVENT_JSON_SIZE) {
      res.status(400).json({ error: `Individual event exceeds ${MAX_EVENT_JSON_SIZE / 1024}KB limit` });
      return;
    }
  }

  const ingested = await manager.ingestEvents(sessionId, events);
  res.status(201).json({ ingested });
}));

// GET /api/sessions/:id/events — Query events with filters + pagination
eventsRouter.get('/:id/events', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const idResult = sessionIdSchema.safeParse(req.params['id']);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid session ID' }); return; }
  const sessionId = idResult.data;

  const session = await manager.getSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const parsed = queryEventsSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
    return;
  }

  const { source, type, fromTime, toTime, limit, offset } = parsed.data;
  const result = await manager.getEvents(sessionId, { source, type, fromTime, toTime, limit, offset });
  res.json({ events: result.events, total: result.total });
}));

// GET /api/sessions/:id/timeline — Get correlated timeline
eventsRouter.get('/:id/timeline', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const idResult = sessionIdSchema.safeParse(req.params['id']);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid session ID' }); return; }
  const sessionId = idResult.data;

  const timeline = await manager.getTimeline(sessionId);
  if (!timeline) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json(timeline);
}));

// GET /api/sessions/:id/groups — Get correlation groups
eventsRouter.get('/:id/groups', asyncHandler(async (req: Request, res: Response) => {
  const manager = getManager(req);
  const idResult = sessionIdSchema.safeParse(req.params['id']);
  if (!idResult.success) { res.status(400).json({ error: 'Invalid session ID' }); return; }
  const sessionId = idResult.data;

  const groups = await manager.getCorrelationGroups(sessionId);
  if (!groups) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({ groups, total: groups.length });
}));
