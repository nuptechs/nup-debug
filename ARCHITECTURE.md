# Architecture

> Design decisions, data flow, and system internals for Probe.

## System Overview

Probe is a universal runtime debug capture system built as a **Turborepo monorepo** with 10 TypeScript packages. It instruments applications at every layer — browser, network, server, database — and correlates events into a unified timeline.

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Client / Instrumented App                       │
│                                                                     │
│  @nuptechs-probe/browser-agent   @nuptechs-probe/sdk   @nuptechs-probe/network-interceptor     │
│  (Playwright capture)   (Node/browser)  (HTTP proxy/middleware)      │
│         │                    │                    │                  │
│         └────────────────────┼────────────────────┘                  │
│                              │                                      │
│                         EventBus                                    │
│                         (@nuptechs-probe/core)                               │
│                              │                                      │
│              ┌───────────────┼───────────────┐                      │
│              ▼               ▼               ▼                      │
│        @nuptechs-probe/log      @nuptechs-probe/correlation   @nuptechs-probe/reporter         │
│        -collector       -engine              (HTML/JSON/MD)         │
│                              │                                      │
│                              ▼                                      │
│                     StoragePort (persist)                            │
│                     Memory │ File │ Postgres                        │
└─────────────────────────────────────┬───────────────────────────────┘
                                      │
                              ┌───────▼───────┐
                              │ @nuptechs-probe/server │
                              │ Express + WS  │
                              │ :7070         │
                              └───────┬───────┘
                                      │
                              ┌───────▼───────┐
                              │  Dashboard    │
                              │  React 19     │
                              │  :3000 (dev)  │
                              └───────────────┘
```

## Package Dependency Graph

```
@nuptechs-probe/core  ← foundation (types, ports, EventBus, utils)
  ├── @nuptechs-probe/sdk
  ├── @nuptechs-probe/browser-agent
  ├── @nuptechs-probe/log-collector
  ├── @nuptechs-probe/network-interceptor
  ├── @nuptechs-probe/correlation-engine
  ├── @nuptechs-probe/reporter  ← also depends on @nuptechs-probe/correlation-engine
  └── @nuptechs-probe/cli       ← depends on all packages above
       └── @nuptechs-probe/server ← depends on core, correlation-engine, reporter
            └── dashboard  ← depends on server API (runtime, not build)
```

Build order is enforced by Turborepo via `dependsOn: ["^build"]` in `turbo.json`.

## Port/Adapter Pattern

Every external dependency that could be swapped is abstracted behind a **Port** (abstract class with unimplemented methods). Concrete **Adapters** extend the port.

### Ports

| Port | Location | Adapters | Selection |
|------|----------|----------|-----------|
| `StoragePort` | `@nuptechs-probe/core` | `MemoryStorageAdapter`, `FileStorageAdapter`, `PostgresStorageAdapter` | `STORAGE_TYPE` env var |
| `CorrelatorPort` | `@nuptechs-probe/core` | `RequestIdStrategy`, `TemporalStrategy`, `UrlMatchingStrategy` | Config array |
| `ReporterPort` | `@nuptechs-probe/core` | `HtmlReporterAdapter`, `JsonReporterAdapter`, `MarkdownReporterAdapter` | `?format=` query param |
| `BrowserAgentPort` | `@nuptechs-probe/core` | `PlaywrightBrowserAdapter` | Only one adapter |
| `LogSourcePort` | `@nuptechs-probe/core` | `FileLogAdapter`, `DockerLogAdapter`, `StdoutLogAdapter` | Config `source.type` |
| `NetworkCapturePort` | `@nuptechs-probe/core` | `ProxyNetworkAdapter`, `ExpressMiddlewareAdapter` | Config `mode` |

### Why Port/Adapter

Frameworks and the primary database are **not** abstracted:
- Express, React, TypeScript, PostgreSQL — these are foundational, not swappable.
- Only dependencies with a realistic chance of being replaced get a Port.

### Container Pattern

Each package exposes a factory function that selects the right adapter based on environment/config:

```typescript
// Example: storage selection
export function createStorage(config: StorageConfig): StoragePort {
  if (config.type === 'postgres') return new PostgresStorageAdapter(config.connectionString);
  if (config.type === 'file') return new FileStorageAdapter(config.basePath);
  return new MemoryStorageAdapter();
}
```

## Correlation Engine

The correlation engine groups related events from different sources into **correlation groups**. Three strategies run in parallel:

### 1. Request-ID Strategy
Links events sharing the same `correlationId` or `requestId` header. This is the most reliable strategy — if your app propagates `x-probe-correlation-id`, events are grouped deterministically.

### 2. Temporal Strategy
Groups events within a configurable time window (default: 2000ms) after a trigger event (e.g., a browser click). Useful when no correlation header exists but events happen in quick succession.

### 3. URL-Matching Strategy
Matches browser navigations/clicks to network requests by URL pattern similarity. Catches the "user clicked a link → network request fired" pattern.

**Timeline Builder:** After grouping, events are sorted chronologically and enriched with timing metadata (duration between events, gap detection).

## Server Architecture

`@nuptechs-probe/server` is an Express application with WebSocket support:

```
Request Flow:
  → CORS / Helmet / Compression
  → Request Logger (Pino structured logs)
  → Rate Limiter (200 reads/s, 50 writes/s)
  → Auth (API key or JWT) — except /health, /ready, /metrics
  → Route Handler (sessions, events, reports, metrics)
  → Error Handler (centralized, structured error responses)

WebSocket Flow:
  → Connection auth (API key in query or JWT in Sec-WebSocket-Protocol)
  → Subscribe { type: "subscribe", sessionId: "..." }
  → Server pushes events: { type: "event", sessionId, event }
  → Ping/pong keepalive every 30s
  → Rate limit: 20 msg/s per connection
  → Max 50 subscriptions per client
```

### Graceful Shutdown

On `SIGTERM` / `SIGINT`:
1. Stop accepting new connections
2. Close WebSocket server (drain existing connections)
3. Wait up to 30s for in-flight requests
4. Close storage (release Postgres pool)
5. Exit 0

### Health & Observability

| Endpoint | Purpose | Auth Required |
|----------|---------|---------------|
| `GET /health` | Liveness probe — includes pool stats, error rates | No |
| `GET /ready` | Readiness probe — tests storage connectivity | No |
| `GET /metrics` | Prometheus exposition format | No |

**Prometheus Metrics:**
- `http_requests_total` — counter by method, path, status
- `http_request_duration_seconds` — histogram
- `sessions_active` — gauge
- `ws_connections_active/total/rejected` — WebSocket gauges
- `ws_messages_received/sent` — counters
- `ws_subscriptions_active` — gauge
- `errors_total` — counter by type
- `correlators_cached` — gauge
- `probe_pg_pool_total/idle/waiting/max_connections` — Postgres pool gauges
- `probe_pg_circuit_breaker_state` — circuit breaker status

## Storage Architecture

### Memory (default)
In-process Maps. Fast, no setup, data lost on restart. Good for development and single-session debugging.

### File
JSON files on disk under `STORAGE_PATH`. Survives restarts but slow for large datasets. Good for CI/local use.

### PostgreSQL (production)
Full ACID storage with:
- **Advisory locks** on migrations to prevent concurrent schema changes
- **Connection pool** (pg) with configurable max connections
- **Connection warmup** — preloads `min(4, maxConnections)` on initialize
- **Slow query detection** — logs queries exceeding 500ms threshold
- **Circuit breaker** — stops hitting the DB after repeated failures, auto-recovers
- **Pool stats collection** — periodic (10s) metrics pushed to Prometheus

## Dashboard Architecture

React 19 single-page application served by the probe server in production:

- **React Router 7** — client-side routing (Overview, Sessions, Traces, Logs, Errors, Settings)
- **TanStack Query 5** — data fetching with 10s stale time, 2 retries, smart invalidation
- **Recharts** — throughput charts, source distribution pie charts
- **Tailwind CSS 3** — utility-first styling
- **Code splitting** — lazy-loaded route components via `React.lazy()`

In development, Vite serves the dashboard on `:3000` with a proxy to the API on `:7070`.

## Security Model

| Layer | Mechanism |
|-------|-----------|
| Transport | HTTPS recommended (reverse proxy) |
| Auth | API keys (≥16 chars, timing-safe comparison) or JWT (≥32 char secret) |
| Headers | Helmet (CSP, X-Frame-Options, HSTS, etc.) |
| Input | Zod schemas on every endpoint, path traversal prevention |
| Rate Limiting | Token bucket — 200 reads/s, 50 writes/s per IP |
| WebSocket | Auth on connection, 20 msg/s rate limit, 50 sub cap |
| SSRF | Blocklist for private IPs/ranges in proxy adapter |
| Redaction | Configurable header/body field redaction in captured events |
| Container | Non-root user (`probe:1001`), Alpine base |

## CI/CD Pipeline

```
Push to main / PR:
  ┌── typecheck (tsc --noEmit)
  ├── test (Vitest, Node 20+22 matrix, coverage on 20)
  ├── security-audit (npm audit --audit-level=high)
  └── docker (build → health check → GHCR push on main)

Tag v*:
  └── validate → Docker push (versioned) → GitHub Release

Weekly (Dependabot):
  └── npm + Docker + GitHub Actions dependency PRs
```

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| **TypeScript strict mode** | Catches bugs at compile time. `noUncheckedIndexedAccess` prevents undefined access. |
| **ESM only** | Modern module system. No CommonJS dual-package hazard. |
| **Turborepo** | Fast incremental builds via caching. Simple npm workspaces under the hood. |
| **Vitest over Jest** | Native ESM support, faster, compatible API. Single config for all packages. |
| **Express over Fastify** | Mature ecosystem, familiar API. Performance is secondary to correctness for a debug tool. |
| **Zod for validation** | Runtime type checking that mirrors TypeScript types. Prevents invalid data at boundaries. |
| **Pino for logging** | Structured JSON logs, fastest Node.js logger, low allocation overhead. |
| **Multi-stage Docker** | Builder stage discarded. Production image is ~155MB, runs as non-root. |
| **Advisory locks** | Prevents two server instances from running migrations simultaneously. |
| **Circuit breaker** | Protects Postgres from avalanche failures. Auto-recovers after cooldown. |
