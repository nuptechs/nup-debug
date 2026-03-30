import { useMemo } from 'react';
import { AlertTriangle, ExternalLink } from 'lucide-react';
import { useSessions, useSessionEvents } from '../hooks/useApi';
import { classNames, formatTimestamp, formatRelativeTime } from '../utils/format';

interface ErrorEntry {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  source: string;
  count: number;
  lastSeen: string;
  sessionId: string;
}

export default function Errors() {
  const { data: sessionsData } = useSessions();
  const sessions = sessionsData?.sessions || [];
  const firstSession = sessions[0]?.id;

  const { data: eventsData } = useSessionEvents(firstSession || '', {
    type: 'error',
    limit: 200,
  });

  const errors = useMemo(() => {
    if (!eventsData?.events) return [];
    const grouped = new Map<string, ErrorEntry>();

    for (const e of eventsData.events) {
      const msg = (e.data.message as string) || 'Unknown error';
      const key = msg.slice(0, 100);
      const existing = grouped.get(key);

      if (existing) {
        existing.count++;
        if (e.timestamp > existing.lastSeen) existing.lastSeen = e.timestamp;
      } else {
        grouped.set(key, {
          id: e.id,
          timestamp: e.timestamp,
          message: msg,
          stack: e.data.stack as string | undefined,
          source: e.source,
          count: 1,
          lastSeen: e.timestamp,
          sessionId: e.sessionId,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.count - a.count);
  }, [eventsData]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Errors</h1>
          <p className="text-sm text-slate-400 mt-1">
            {errors.length} unique errors tracked
          </p>
        </div>
      </div>

      {errors.length > 0 ? (
        <div className="space-y-3">
          {errors.map((error) => (
            <ErrorCard key={error.id} error={error} />
          ))}
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <AlertTriangle className="w-8 h-8 text-emerald-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No errors detected</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Great news! No errors have been captured yet. The dashboard will display error
            patterns when they occur.
          </p>
        </div>
      )}
    </div>
  );
}

function ErrorCard({ error }: { error: ErrorEntry }) {
  return (
    <div className="glass-card p-5 hover:border-red-500/30 transition-colors group">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3 mb-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
            <h3 className="text-sm font-medium text-red-300 truncate">{error.message}</h3>
          </div>

          {error.stack && (
            <pre className="text-[10px] font-mono text-slate-500 mt-2 mb-3 overflow-hidden max-h-20 leading-relaxed">
              {error.stack.split('\n').slice(0, 4).join('\n')}
            </pre>
          )}

          <div className="flex items-center gap-4 text-xs text-slate-500">
            <span>Source: <span className="text-slate-400">{error.source}</span></span>
            <span>First: <span className="text-slate-400">{formatTimestamp(error.timestamp)}</span></span>
            <span>Last: <span className="text-slate-400">{formatRelativeTime(error.lastSeen)}</span></span>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 ml-4">
          <div className={classNames(
            'px-3 py-1.5 rounded-lg text-sm font-bold',
            error.count >= 100 ? 'bg-red-500/20 text-red-400' :
            error.count >= 10 ? 'bg-amber-500/20 text-amber-400' :
            'bg-slate-500/20 text-slate-400',
          )}>
            {error.count}x
          </div>
          <ExternalLink className="w-4 h-4 text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>
    </div>
  );
}
