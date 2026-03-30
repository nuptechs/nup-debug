import { Link } from 'react-router-dom';
import { Plus, Trash2, ExternalLink } from 'lucide-react';
import { useSessions, useCreateSession, useDeleteSession } from '../hooks/useApi';
import StatusBadge from '../components/StatusBadge';
import { formatRelativeTime, formatNumber } from '../utils/format';

export default function Sessions() {
  const { data, isLoading } = useSessions();
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const sessions = data?.sessions || [];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Sessions</h1>
          <p className="text-sm text-slate-400 mt-1">
            {data?.total || 0} total sessions
          </p>
        </div>
        <button
          onClick={() => createSession.mutate({})}
          disabled={createSession.isPending}
          className="flex items-center gap-2 bg-probe-accent hover:bg-probe-accent/80 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          New Session
        </button>
      </div>

      {/* Sessions grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="glass-card p-5 animate-pulse">
              <div className="h-4 bg-slate-700/50 rounded w-3/4 mb-3" />
              <div className="h-3 bg-slate-700/50 rounded w-1/2 mb-2" />
              <div className="h-3 bg-slate-700/50 rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="glass-card p-12 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-probe-accent/10 flex items-center justify-center">
            <Plus className="w-8 h-8 text-probe-accent-light" />
          </div>
          <h3 className="text-lg font-semibold text-slate-200 mb-2">No sessions yet</h3>
          <p className="text-sm text-slate-400 mb-4 max-w-sm mx-auto">
            Create a new session to start capturing events from your application.
          </p>
          <button
            onClick={() => createSession.mutate({})}
            className="bg-probe-accent hover:bg-probe-accent/80 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
          >
            Create First Session
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sessions.map((session) => (
            <Link
              key={session.id}
              to={`/sessions/${session.id}`}
              className="glass-card p-5 hover:border-probe-accent/30 transition-all duration-200 group"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <StatusBadge status={session.status} />
                  </div>
                  <p className="text-xs font-mono text-slate-500 truncate mb-3">{session.id}</p>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <p className="text-slate-500">Events</p>
                      <p className="text-slate-200 font-semibold">{formatNumber(session.eventCount)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Sources</p>
                      <p className="text-slate-200 font-semibold">{session.sources.length || 0}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Created</p>
                      <p className="text-slate-200">{formatRelativeTime(session.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Updated</p>
                      <p className="text-slate-200">{formatRelativeTime(session.updatedAt)}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      deleteSession.mutate(session.id);
                    }}
                    className="p-1.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
