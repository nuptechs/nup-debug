// ============================================================
// XHR Interceptor — Monkey-patches XMLHttpRequest
// Injects correlation headers and emits request events
// ============================================================

import type { SdkEvent } from '@probe/core';

type EventHandler = (event: Omit<SdkEvent, 'id' | 'sessionId' | 'timestamp'>) => void;

export interface XhrInterceptorConfig {
  correlationHeader: string;
  correlationId?: string;
  onEvent: EventHandler;
}

/**
 * Install an XHR interceptor that:
 * - Injects correlation ID header into every outgoing request
 * - Emits request-start and request-end events
 * - Tracks request duration
 *
 * Returns a restore function that puts the originals back.
 */
export function installXhrInterceptor(config: XhrInterceptorConfig): () => void {
  const XHR = XMLHttpRequest.prototype;
  const originalOpen = XHR.open;
  const originalSend = XHR.send;

  let requestCounter = 0;

  // Store per-instance metadata via a WeakMap to avoid polluting the XHR object
  const metadata = new WeakMap<
    XMLHttpRequest,
    { method: string; url: string; requestId: string; startTime: number }
  >();

  XHR.open = function(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    const resolvedUrl = url instanceof URL ? url.href : String(url);
    const requestId = `browser-xhr-${++requestCounter}-${Date.now().toString(36)}`;

    metadata.set(this, {
      method: method.toUpperCase(),
      url: resolvedUrl,
      requestId,
      startTime: 0, // set at send time
    });

    // Call through with explicit arity to satisfy the overloaded signature
    if (async !== undefined) {
      originalOpen.call(this, method, url, async, username ?? null, password ?? null);
    } else {
      (originalOpen as Function).call(this, method, url);
    }
  } as typeof XHR.open;

  XHR.send = function(this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null): void {
    const xhr = this;
    const meta = metadata.get(xhr);

    if (meta) {
      meta.startTime = performance.now();

      // Inject correlation header
      if (config.correlationId) {
        try {
          xhr.setRequestHeader(config.correlationHeader, config.correlationId);
        } catch {
          // setRequestHeader throws if state is not OPENED — ignore silently
        }
      }

      // Emit request-start
      config.onEvent({
        source: 'sdk',
        type: 'request-start' as const,
        requestId: meta.requestId,
        method: meta.method,
        url: meta.url,
      } as Omit<SdkEvent, 'id' | 'sessionId' | 'timestamp'>);

      // Attach completion listeners
      const emitEnd = (error?: string) => {
        const duration = performance.now() - meta.startTime;

        config.onEvent({
          source: 'sdk',
          type: 'request-end' as const,
          requestId: meta.requestId,
          statusCode: xhr.status || 0,
          duration: Math.round(duration * 100) / 100,
          ...(error ? { error } : {}),
        } as Omit<SdkEvent, 'id' | 'sessionId' | 'timestamp'>);

        metadata.delete(xhr);
      };

      xhr.addEventListener('load', () => emitEnd());
      xhr.addEventListener('error', () => emitEnd('Network error'));
      xhr.addEventListener('abort', () => emitEnd('Request aborted'));
      xhr.addEventListener('timeout', () => emitEnd('Request timed out'));
    }

    originalSend.call(xhr, body);
  };

  // Return restore function
  return () => {
    XHR.open = originalOpen;
    XHR.send = originalSend;
  };
}
