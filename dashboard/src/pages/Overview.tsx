import { useEffect, useState, useCallback } from 'react';
import {
  Activity, Radio, AlertTriangle, Clock, Zap, Database, Globe, Server,
} from 'lucide-react';
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import MetricCard from '../components/MetricCard';
import EventTable from '../components/EventTable';
import { useSessions } from '../hooks/useApi';
import { useWebSocket } from '../hooks/useWebSocket';
import type { ProbeEvent } from '../api/client';
import { formatNumber } from '../utils/format';

interface RealtimeMetrics {
  eventsPerSecond: number;
  totalEvents: number;
  errorRate: number;
  avgLatency: number;
  activeSessions: number;
}

const CHART_COLORS = ['#7c3aed', '#3b82f6', '#10b981', '#f59e0b'];

export default function Overview() {
  const { data: sessionsData } = useSessions();
  const { subscribe } = useWebSocket();
  const [recentEvents, setRecentEvents] = useState<ProbeEvent[]>([]);
  const [metrics, setMetrics] = useState<RealtimeMetrics>({
    eventsPerSecond: 0,
    totalEvents: 0,
    errorRate: 0,
    avgLatency: 0,
    activeSessions: 0,
  });
  const [throughputHistory, setThroughputHistory] = useState<{ time: string; events: number }[]>([]);

  const handleMessage = useCallback((msg: { type: string; data: unknown }) => {
    if (msg.type === 'event') {
      const event = msg.data as ProbeEvent;
      setRecentEvents((prev) => [event, ...prev].slice(0, 50));
      setMetrics((prev) => ({ ...prev, totalEvents: prev.totalEvents + 1 }));
    }
    if (msg.type === 'metric') {
      setMetrics((prev) => ({ ...prev, ...(msg.data as Partial<RealtimeMetrics>) }));
    }
  }, []);

  useEffect(() => subscribe(handleMessage), [subscribe, handleMessage]);

  // Simulated throughput history for chart
  useEffect(() => {
    const interval = setInterval(() => {
      setThroughputHistory((prev) => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false, second: '2-digit' });
        const next = [...prev, { time, events: metrics.eventsPerSecond + Math.random() * 5 }];
        return next.slice(-30);
      });
    }, 2000);
    return () => clearInterval(interval);
  }, [metrics.eventsPerSecond]);

  const sessions = sessionsData?.sessions || [];
  const activeSessions = sessions.filter((s) => s.status === 'capturing').length;
  const totalEventCount = sessions.reduce((sum, s) => sum + s.eventCount, 0);

  // Source distribution for pie chart
  const sourceDist = [
    { name: 'Browser', value: 30 },
    { name: 'Network', value: 40 },
    { name: 'Logs', value: 20 },
    { name: 'SDK', value: 10 },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-sm text-slate-400 mt-1">Real-time observability overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Active Sessions"
          value={activeSessions}
          subtitle={`${sessions.length} total`}
          icon={<Radio className="w-5 h-5" />}
          color="violet"
          trend={{ value: 12, label: 'vs last hour' }}
        />
        <MetricCard
          title="Total Events"
          value={formatNumber(totalEventCount || metrics.totalEvents)}
          subtitle="across all sessions"
          icon={<Activity className="w-5 h-5" />}
          color="blue"
          trend={{ value: 8, label: 'vs last hour' }}
        />
        <MetricCard
          title="Error Rate"
          value={`${metrics.errorRate.toFixed(1)}%`}
          subtitle="last 5 minutes"
          icon={<AlertTriangle className="w-5 h-5" />}
          color="red"
          trend={{ value: -3, label: 'improving' }}
        />
        <MetricCard
          title="Avg Latency"
          value={`${metrics.avgLatency || 42}ms`}
          subtitle="P95: 120ms"
          icon={<Clock className="w-5 h-5" />}
          color="emerald"
          trend={{ value: -5, label: 'faster' }}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Throughput chart */}
        <div className="glass-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-200">Event Throughput</h2>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Zap className="w-3.5 h-3.5 text-probe-accent" />
              <span>{metrics.eventsPerSecond.toFixed(0)} events/s</span>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={throughputHistory}>
              <defs>
                <linearGradient id="throughputGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#7c3aed" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#1a2236', border: '1px solid #2a3550', borderRadius: '8px', fontSize: '12px' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Area type="monotone" dataKey="events" stroke="#7c3aed" fill="url(#throughputGradient)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Source distribution */}
        <div className="glass-card p-5">
          <h2 className="text-sm font-semibold text-slate-200 mb-4">Event Sources</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={sourceDist}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
              >
                {sourceDist.map((_, index) => (
                  <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1a2236', border: '1px solid #2a3550', borderRadius: '8px', fontSize: '12px' }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="flex items-center justify-center gap-4 mt-2">
            {sourceDist.map((item, i) => (
              <div key={item.name} className="flex items-center gap-1.5 text-xs text-slate-400">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                {item.name}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Infrastructure status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="glass-card p-4 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-emerald-500/10">
            <Server className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">Probe Server</p>
            <p className="text-xs text-emerald-400">Healthy — Port 7070</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-blue-500/10">
            <Database className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">Storage</p>
            <p className="text-xs text-blue-400">SQLite — 24MB used</p>
          </div>
        </div>
        <div className="glass-card p-4 flex items-center gap-4">
          <div className="p-3 rounded-xl bg-violet-500/10">
            <Globe className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-medium text-slate-200">Ingestion</p>
            <p className="text-xs text-violet-400">HTTP + WebSocket</p>
          </div>
        </div>
      </div>

      {/* Recent events */}
      <div className="glass-card p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-200">Recent Events</h2>
          <span className="text-xs text-slate-500">Live stream</span>
        </div>
        <EventTable events={recentEvents.slice(0, 10)} />
      </div>
    </div>
  );
}
