// ============================================================
// Probe — Express Demo App
// Demonstrates full SDK instrumentation of a sample REST API
// ============================================================

import express from 'express';
import {
  createProbeMiddleware,
  SdkEventCollector,
  createLogInterceptor,
  wrapConsole,
} from '@nuptechs-probe/sdk';

const app = express();
app.use(express.json());

// ---- Initialize Probe SDK Instrumentation ----
const collector = new SdkEventCollector();
collector.setSessionId('express-demo');

// Log all collected events to console (in production these go to the server)
collector.onEvent((event) => {
  console.log('[probe]', JSON.stringify({ type: (event as Record<string, unknown>).type, id: event.id }));
});

// Auto-capture all console.log/warn/error calls
const logInterceptor = createLogInterceptor(collector);
const restoreConsole = wrapConsole(logInterceptor);

// Install HTTP instrumentation middleware
app.use(createProbeMiddleware({
  config: {
    enabled: true,
    serverUrl: process.env['PROBE_SERVER_URL'] ?? 'http://localhost:7070',
    apiKey: process.env['PROBE_API_KEY'] ?? '',
    correlationHeader: 'x-correlation-id',
    sampleRate: 1,
    bufferSize: 100,
    flushIntervalMs: 5000,
    redactedHeaders: ['authorization', 'cookie'],
    maxPayloadBytes: 1024 * 64,
  },
  collector,
  sessionId: 'express-demo',
}));

// ---- Sample in-memory data store ----
interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
}

let nextId = 1;
const todos: Todo[] = [];

// ---- Routes ----
app.get('/api/todos', (_req, res) => {
  console.info(`Listing ${todos.length} todos`);
  res.json({ data: todos, total: todos.length });
});

app.get('/api/todos/:id', (req, res) => {
  const todo = todos.find((t) => t.id === Number(req.params['id']));
  if (!todo) {
    console.warn(`Todo ${req.params['id']} not found`);
    return res.status(404).json({ error: 'Todo not found' });
  }
  res.json({ data: todo });
});

app.post('/api/todos', (req, res) => {
  const { title } = req.body;
  if (!title?.trim()) {
    console.warn('Validation failed: title is required');
    return res.status(400).json({ error: 'Title is required' });
  }

  const todo: Todo = {
    id: nextId++,
    title: title.trim(),
    completed: false,
    createdAt: new Date().toISOString(),
  };
  todos.push(todo);
  console.info(`Created todo #${todo.id}: ${todo.title}`);
  res.status(201).json({ data: todo });
});

app.patch('/api/todos/:id', (req, res) => {
  const todo = todos.find((t) => t.id === Number(req.params['id']));
  if (!todo) {
    return res.status(404).json({ error: 'Todo not found' });
  }

  if (req.body.title !== undefined) todo.title = req.body.title;
  if (req.body.completed !== undefined) todo.completed = req.body.completed;
  console.info(`Updated todo #${todo.id}`);
  res.json({ data: todo });
});

app.delete('/api/todos/:id', (req, res) => {
  const idx = todos.findIndex((t) => t.id === Number(req.params['id']));
  if (idx === -1) {
    return res.status(404).json({ error: 'Todo not found' });
  }
  const [removed] = todos.splice(idx, 1);
  console.info(`Deleted todo #${removed!.id}: ${removed!.title}`);
  res.status(204).end();
});

// Error simulation endpoint (for testing error tracking)
app.get('/api/simulate-error', (_req, _res) => {
  console.error('Simulated unhandled error');
  throw new Error('Simulated unhandled error');
});

// Global error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(`Unhandled error: ${err.message}`);
  collector.emit({ type: 'unhandled_error', level: 'fatal', data: { message: err.message, stack: err.stack } });
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Start ----
const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
app.listen(PORT, () => {
  console.log(`[express-demo] Running on http://localhost:${PORT}`);
  console.log(`[express-demo] Probe middleware active — events collected automatically`);
  console.log(`[express-demo] Try: curl http://localhost:${PORT}/api/todos`);
});

// Clean shutdown
process.on('SIGTERM', () => {
  restoreConsole();
  process.exit(0);
});

export { app };
