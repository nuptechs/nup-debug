import { useMemo } from 'react';
import { ScrollText } from 'lucide-react';
import LogViewer from '../components/LogViewer';
import { useSessions, useSessionEvents } from '../hooks/useApi';

export default function Logs() {
  const { data: sessionsData } = useSessions();
  const sessions = sessionsData?.sessions || [];
  const firstSession = sessions[0]?.id;

  const { data: eventsData } = useSessionEvents(firstSession || '', {
    source: 'log',
    limit: 500,
  });

  const logEntries = useMemo(() => {
    if (!eventsData?.events) return [];
    return eventsData.events.map((e) => ({
      id: e.id,
      timestamp: e.timestamp,
      level: (e.data.level as string) || 'info',
      message: (e.data.message as string) || JSON.stringify(e.data),
      source: (e.data.source as string) || undefined,
      metadata: e.metadata,
    }));
  }, [eventsData]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Logs</h1>
        <p className="text-sm text-slate-400 mt-1">Search and filter application logs</p>
      </div>

      {logEntries.length > 0 ? (
        <div className="glass-card p-5">
          <LogViewer logs={logEntries} />
        </div>
      ) : (
        <div className="glass-card p-12 text-center">
          <ScrollText className="w-12 h-12 text-slate-600 mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-slate-300 mb-2">No logs yet</h3>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            Configure log sources to start capturing application logs. Supports file tailing,
            Docker container logs, and stdout interception.
          </p>
        </div>
      )}
    </div>
  );
}
