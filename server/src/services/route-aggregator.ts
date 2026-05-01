// ============================================================
// Route aggregator — derives `runtimeHits[]` from probe events
// for the Sentinel TripleOrphanDetector (Onda 2 / Vácuo 2).
//
// Pure function: takes raw probe events, returns hit counts per
// canonical (method, path) tuple.
//
// Behavior contract:
//   - Considers only RequestEvent (network source, type='request').
//     Responses are not counted — they would double the tally.
//   - Path canonicalization: parses URL with `new URL(...)`, takes
//     pathname only. Numeric segments are replaced with `:id` so
//     `/api/users/42` collapses with `/api/users/99` into the same
//     route. UUIDs are also collapsed via a coarse regex.
//   - Skips invalid URLs / requests without a usable URL.
//   - Counts include `lastSeenAt` so the detector can apply a
//     freshness threshold downstream.
// ============================================================

import type { ProbeEvent } from '@nuptechs-sentinel-probe/core';

export type RuntimeHit = {
  method: string;
  path: string;
  occurrenceCount: number;
  lastSeenAt: string;
};

export type RuntimeHitsStats = {
  eventsScanned: number;
  requestsCounted: number;
  requestsSkippedNoUrl: number;
  requestsSkippedBadUrl: number;
  uniqueRoutes: number;
};

export type RuntimeHitsResult = {
  hits: RuntimeHit[];
  stats: RuntimeHitsStats;
};

const NUMERIC_SEGMENT = /^\d+$/;
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_LONG = /^[0-9a-f]{16,}$/i;

function canonicalizePath(rawUrl: string): string | null {
  let pathname: string;
  try {
    // Allow relative URLs by giving a dummy origin.
    const u = new URL(rawUrl, 'http://_/');
    pathname = u.pathname || '/';
  } catch {
    return null;
  }
  if (!pathname || pathname === '/') return pathname || '/';
  const parts = pathname.split('/').filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const seg = parts[i];
    if (!seg) continue;
    if (NUMERIC_SEGMENT.test(seg) || UUID_SEGMENT.test(seg) || HEX_LONG.test(seg)) {
      parts[i] = ':id';
    }
  }
  return '/' + parts.join('/');
}

type AccumulatedHit = { count: number; lastSeenAt: number };

export function extractRuntimeHits(
  events: ReadonlyArray<ProbeEvent>,
): RuntimeHitsResult {
  const stats: RuntimeHitsStats = {
    eventsScanned: events.length,
    requestsCounted: 0,
    requestsSkippedNoUrl: 0,
    requestsSkippedBadUrl: 0,
    uniqueRoutes: 0,
  };

  const acc = new Map<string, AccumulatedHit>();

  for (const ev of events) {
    if (ev.source !== 'network') continue;
    const evType = (ev as { type?: string }).type;
    if (evType !== 'request') continue;

    const url = (ev as { url?: string }).url;
    if (typeof url !== 'string' || url.length === 0) {
      stats.requestsSkippedNoUrl++;
      continue;
    }
    const path = canonicalizePath(url);
    if (path === null) {
      stats.requestsSkippedBadUrl++;
      continue;
    }
    const method = String((ev as { method?: string }).method || 'GET').toUpperCase();
    const key = `${method} ${path}`;
    const ts = typeof ev.timestamp === 'number' ? ev.timestamp : Date.now();
    const cur = acc.get(key);
    if (cur) {
      cur.count++;
      if (ts > cur.lastSeenAt) cur.lastSeenAt = ts;
    } else {
      acc.set(key, { count: 1, lastSeenAt: ts });
    }
    stats.requestsCounted++;
  }

  const hits: RuntimeHit[] = [];
  for (const [key, val] of acc.entries()) {
    const sep = key.indexOf(' ');
    if (sep < 0) continue;
    const method = key.slice(0, sep);
    const path = key.slice(sep + 1);
    hits.push({
      method,
      path,
      occurrenceCount: val.count,
      lastSeenAt: new Date(val.lastSeenAt).toISOString(),
    });
  }
  stats.uniqueRoutes = hits.length;

  hits.sort((a, b) => {
    if (a.method !== b.method) return a.method < b.method ? -1 : 1;
    return a.path < b.path ? -1 : 1;
  });

  return { hits, stats };
}
