// ============================================================
// W3C Trace Context (https://www.w3.org/TR/trace-context/)
// Parsing, formatting, and generation of traceparent headers
// ============================================================

export interface TraceContext {
  readonly version: string;      // always '00'
  readonly traceId: string;      // 32 hex chars
  readonly parentSpanId: string; // 16 hex chars
  readonly traceFlags: number;   // bit field (01 = sampled)
}

const TRACEPARENT_RE = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const INVALID_TRACE_ID = '00000000000000000000000000000000';
const INVALID_SPAN_ID = '0000000000000000';

/** Parse a traceparent header value. Returns null for invalid input. */
export function parseTraceparent(header: string): TraceContext | null {
  if (typeof header !== 'string') return null;

  const match = header.trim().toLowerCase().match(TRACEPARENT_RE);
  if (!match) return null;

  const version = match[1]!;
  const traceId = match[2]!;
  const parentSpanId = match[3]!;
  const flags = match[4]!;

  // All-zero trace-id and span-id are explicitly invalid per spec
  if (traceId === INVALID_TRACE_ID) return null;
  if (parentSpanId === INVALID_SPAN_ID) return null;

  return {
    version,
    traceId,
    parentSpanId,
    traceFlags: parseInt(flags, 16),
  };
}

/** Create a traceparent header value from a TraceContext */
export function formatTraceparent(ctx: TraceContext): string {
  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  return `${ctx.version}-${ctx.traceId}-${ctx.parentSpanId}-${flags}`;
}

/** Generate a new trace context with a fresh traceId and spanId */
export function createTraceContext(sampled = true): TraceContext {
  return {
    version: '00',
    traceId: generateTraceId(),
    parentSpanId: generateSpanId(),
    traceFlags: sampled ? 0x01 : 0x00,
  };
}

/** Create a child span context (new spanId, same traceId and flags) */
export function createChildContext(parent: TraceContext): TraceContext {
  return {
    version: parent.version,
    traceId: parent.traceId,
    parentSpanId: generateSpanId(),
    traceFlags: parent.traceFlags,
  };
}

/** Generate a 32-char hex trace ID */
export function generateTraceId(): string {
  return randomHex(16); // 16 bytes = 32 hex chars
}

/** Generate a 16-char hex span ID */
export function generateSpanId(): string {
  return randomHex(8); // 8 bytes = 16 hex chars
}

// ---- Internal ----

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}
