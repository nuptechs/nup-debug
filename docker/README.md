# Consumer Docker template

This folder ships a **drop-in `docker-compose.example.yml`** for projects that
want to run a local **Sentinel Probe** next to their application and federate
findings into the central Sentinel orchestrator at
[`sentinel.nuptechs.com`](https://sentinel.nuptechs.com).

## What you get

- `probe-server` — built from the upstream repo via `build.context:
  https://github.com/nuptechs/nup-sentinel-probe.git#main` (no host clone
  required). Bound to `127.0.0.1:7070`, healthchecked, and configured to ship
  findings to the central Sentinel using your `SENTINEL_API_KEY` +
  `SENTINEL_PROJECT_ID`. Pin `#main` to a tag (e.g. `#v0.1.0`) for
  reproducible deploys, or swap to a published `ghcr.io` image once
  available.
- `probe-postgres` — Postgres 16 storage for the probe's local session/event
  state. Bound to `127.0.0.1:5532` (non-default port, no host clash).
- A persistent named volume (`probe_pgdata`).

## Quick start

```bash
# 1. Copy the env template
cp docker/.env.example .env

# 2. Fill SENTINEL_API_KEY, SENTINEL_PROJECT_ID, PROBE_INGEST_API_KEY,
#    PROBE_POSTGRES_PASSWORD. Generate the ingest key with:
#       openssl rand -hex 32

# 3. Bring it up
docker compose -f docker/docker-compose.example.yml up -d

# 4. Smoke test
curl -fsS http://localhost:7070/health
```

## Wiring your app to the probe

Your application instruments runtime evidence (clicks, requests, log lines,
DB queries) by POSTing to the probe ingest endpoint:

```bash
curl -X POST http://localhost:7070/api/sessions \
  -H "X-Probe-API-Key: $PROBE_INGEST_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "tag": "qa-run-2026-05-06" }'
```

The probe forwards aggregated findings to `${SENTINEL_URL}` automatically.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SENTINEL_URL` | yes (defaulted) | Central Sentinel base URL. Default: `https://sentinel.nuptechs.com` |
| `SENTINEL_API_KEY` | **yes** | Tenant-scoped API key (`nup_sentinel_*`) |
| `SENTINEL_PROJECT_ID` | **yes** | Sentinel project slug (e.g. `nup-school`) |
| `SENTINEL_ORG_ID` | no | Optional org override (auto-resolved from API key) |
| `PROBE_INGEST_API_KEY` | **yes** | Shared secret your app sends as `X-Probe-API-Key` |
| `PROBE_POSTGRES_PASSWORD` | **yes** | Postgres password for probe's local DB |
| `PROBE_POSTGRES_DB` / `PROBE_POSTGRES_USER` | no | DB name/user (defaults: `probe` / `probe`) |

## Operational notes

- All ports bind to `127.0.0.1` by default. To accept ingest from other hosts on
  your LAN, change the host bind in `docker-compose.example.yml`.
- The probe is built from source via Docker's git URL context. The first `up`
  takes ~1–2 min to clone + compile; subsequent `up` calls reuse the build
  cache. Pin `#main` to a tag (e.g. `#v0.1.0`) for reproducible deploys.
- The probe Postgres is intentionally bound to port `5532` (not `5432`) to avoid
  clashing with your application's own Postgres.
- For the *probe project's own dev workflow* (building from source, watch mode,
  etc.), use the root [`docker-compose.yml`](../docker-compose.yml) instead.
