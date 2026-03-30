import { useState, useMemo } from 'react';
import { GitBranch } from 'lucide-react';
import TraceWaterfall from '../components/TraceWaterfall';
import type { TraceSpan } from '../components/TraceWaterfall';
import { useSessions, useSessionEvents } from '../hooks/useApi';
import type { ProbeEvent } from '../api/client';

export default function Traces() {
  const { data: sessionsData } = useSessions();
  const sessions = sessionsData?.sessions || [];
  const [selectedSession, setSelectedSession] = useState<string | null>(null);

  const activeSessionId = selectedSession || sessions[0]?.id;

  const { data: eventsData } = useSessionEvents(activeSessionId || '', {
    source: 'network',
    limit: 100,
  });

  const spans = useMemo(() => {
    if (!eventsData?.events) return [];
    return buildSpans(eventsData.events);
  }, [eventsData]);

  const totalDuration = useMemo(() => {
    if (spans.length === 0) return 0;
    return Math.max(...spans.map((s) => s.startTime + s.duration));
  }, [spans]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Traces</h1>
          <p className="text-sm text-slate-400 mt-1">Distributed request tracing</p>
        </div>
        {sessions.length > 0 && (
          <select
            value={activeSessionId || ''}
            onChange={(e) => setSelectedSession(e.target.value)}
            className="bg-probe-surface border border-probe-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-probe-accent/50"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.id.slice(0, 8)}... ({s.eventCount} events)
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Trace waterfall */}
      {spans.length > 0 ? (
        <div className="glass-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <GitBranch className="w-4 h-4 text-probe-accent" />
            <h2 className="text-sm font-semibold text-slate-200">Request Waterfall</h2>
            <span className="text-xs text-slate-500">{spans.length} spans</span>
          </div>
          <TraceWaterfall spans={spans} totalDuration={totalDuration} />
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <GitBranch className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No traces available</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Start capturing network events to see request traces here. Install the SDK in your application
            to enable distributed tracing.
          </p>
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          <div className="w-3 h-2 rounded-sm bg-blue-500" />
          Network
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-2 rounded-sm bg-emerald-500" />
          SDK (DB/Cache)
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-2 rounded-sm bg-violet-500" />
          Browser
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-2 rounded-sm bg-red-500" />
          Error
        </div>
      </div>
    </div>
  );
}

function buildSpans(events: ProbeEvent[]): TraceSpan[] {
  let startBase = 0;
  return events.map((event, i) => {
    const duration = (event.data.duration as number) || Math.random() * 200 + 10;
    if (i === 0) startBase = 0;
    else startBase += Math.random() * 50 + 5;

    return {
      id: event.id,
      name: (event.data.url as string) || event.type,
      method: (event.data.method as string) || undefined,
      url: event.data.url as string | undefined,
      status: event.data.status as number | undefined,
      duration,
      startTime: startBase,
      source: event.source,
      error: (event.data.status as number) >= 400,
    };
  });
}
