import { useEffect, useRef, useCallback, useState } from 'react';

interface WebSocketMessage {
  type: 'event' | 'session-update' | 'metric';
  data: unknown;
}

type MessageHandler = (msg: WebSocketMessage) => void;

export function useWebSocket(path: string = '/ws') {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef<Set<MessageHandler>>(new Set());
  const [connected, setConnected] = useState(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    // Include API key as query param for WebSocket auth
    const apiKey = sessionStorage.getItem('probe-api-key') ?? '';
    const tokenParam = apiKey ? `?token=${encodeURIComponent(apiKey)}` : '';
    const ws = new WebSocket(`${protocol}//${host}${path}${tokenParam}`);

    ws.onopen = () => {
      setConnected(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as WebSocketMessage;
        handlersRef.current.forEach((handler) => handler(msg));
      } catch {
        // ignore malformed messages
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [path]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((handler: MessageHandler) => {
    handlersRef.current.add(handler);
    return () => { handlersRef.current.delete(handler); };
  }, []);

  const send = useCallback((data: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  return { connected, subscribe, send };
}
