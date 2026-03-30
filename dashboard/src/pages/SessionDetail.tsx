import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Download, Play, Pause, Square } from 'lucide-react';
import { useSession, useSessionEvents, useTimeline } from '../hooks/useApi';
import { api } from '../api/client';
import StatusBadge from '../components/StatusBadge';
import EventTable from '../components/EventTable';
import TimelineView from '../components/TimelineView';
import { formatRelativeTime, formatNumber, classNames } from '../utils/format';

type Tab = 'events' | 'timeline' | 'report';

export default function SessionDetail() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = useState<Tab>('events');
  const [sourceFilter, setSourceFilter] = useState<string | undefined>();

  const { data: session, isLoading: sessionLoading } = useSession(id!);
  const { data: eventsData } = useSessionEvents(id!, { source: sourceFilter, limit: 200 });
  const { data: timelineData } = useTimeline(id!);

  if (sessionLoading || !session) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-700/50 rounded w-64" />
          <div className="h-4 bg-slate-700/50 rounded w-48" />
          <div className="h-64 bg-slate-700/50 rounded" />
        </div>
      </div>
    );
  }

  const events = eventsData?.events || [];
  const timeline = timelineData?.timeline || [];

  const handleExport = async (format: 'json' | 'html' | 'markdown') => {
    try {
      const report = await api.reports.generate(id!, format);
      const blob = new Blob([typeof report === 'string' ? report : JSON.stringify(report, null, 2)], {
        type: format === 'json' ? 'application/json' : format === 'html' ? 'text/html' : 'text/markdown',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `probe-session-${id}.${format === 'markdown' ? 'md' : format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // handle error
    }
  };

  const handleStatusChange = async (status: string) => {
    await api.sessions.updateStatus(id!, status);
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/sessions" className="p-2 rounded-lg hover:bg-white/5 text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-white">Session</h1>
              <StatusBadge status={session.status} size="md" />
            </div>
            <p className="text-xs font-mono text-slate-500 mt-1">{session.id}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {session.status === 'capturing' && (
            <>
              <button onClick={() => handleStatusChange('paused')} className="p-2 rounded-lg hover:bg-amber-500/20 text-slate-400 hover:text-amber-400 transition-colors" title="Pause">
                <Pause className="w-4 h-4" />
              </button>
              <button onClick={() => handleStatusChange('completed')} className="p-2 rounded-lg hover:bg-red-500/20 text-slate-400 hover:text-red-400 transition-colors" title="Stop">
                <Square className="w-4 h-4" />
              </button>
            </>
          )}
          {session.status === 'paused' && (
            <button onClick={() => handleStatusChange('capturing')} className="p-2 rounded-lg hover:bg-emerald-500/20 text-slate-400 hover:text-emerald-400 transition-colors" title="Resume">
              <Play className="w-4 h-4" />
            </button>
          )}
          <div className="relative group">
            <button className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-slate-300 transition-colors">
              <Download className="w-4 h-4" />
              Export
            </button>
            <div className="absolute right-0 top-full mt-1 w-36 bg-probe-card border border-probe-border rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10">
              {(['json', 'html', 'markdown'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5 first:rounded-t-lg last:rounded-b-lg capitalize"
                >
                  {fmt}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4">
        <div className="glass-card p-4">
          <p className="text-xs text-slate-500">Events</p>
          <p className="text-xl font-bold text-white mt-1">{formatNumber(session.eventCount)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-slate-500">Sources</p>
          <p className="text-xl font-bold text-white mt-1">{session.sources.length}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-slate-500">Created</p>
          <p className="text-sm font-medium text-white mt-1">{formatRelativeTime(session.createdAt)}</p>
        </div>
        <div className="glass-card p-4">
          <p className="text-xs text-slate-500">Last Update</p>
          <p className="text-sm font-medium text-white mt-1">{formatRelativeTime(session.updatedAt)}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-probe-border">
        <div className="flex gap-6">
          {(['events', 'timeline', 'report'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={classNames(
                'pb-3 text-sm font-medium border-b-2 transition-colors capitalize',
                activeTab === tab
                  ? 'border-probe-accent text-probe-accent-light'
                  : 'border-transparent text-slate-400 hover:text-slate-200',
              )}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Source filters */}
      {activeTab === 'events' && (
        <div className="flex gap-2">
          {['all', 'browser', 'network', 'log', 'sdk'].map((src) => (
            <button
              key={src}
              onClick={() => setSourceFilter(src === 'all' ? undefined : src)}
              className={classNames(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                (src === 'all' && !sourceFilter) || sourceFilter === src
                  ? 'bg-probe-accent/20 text-probe-accent-light'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5',
              )}
            >
              {src}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="glass-card p-5">
        {activeTab === 'events' && <EventTable events={events} />}
        {activeTab === 'timeline' && (
          <TimelineView
            events={timeline.map((t) => t.event)}
          />
        )}
        {activeTab === 'report' && (
          <div className="space-y-4">
            <p className="text-sm text-slate-400">Generate and download reports for this session.</p>
            <div className="flex gap-3">
              {(['html', 'json', 'markdown'] as const).map((fmt) => (
                <button
                  key={fmt}
                  onClick={() => handleExport(fmt)}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-sm text-slate-300 transition-colors capitalize"
                >
                  Download {fmt}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
