import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  MonitorPlay,
  GitBranch,
  ScrollText,
  AlertTriangle,
  Settings,
  Radio,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useWebSocket } from '../hooks/useWebSocket';
import { classNames } from '../utils/format';

const NAV_ITEMS = [
  { to: '/', icon: LayoutDashboard, label: 'Overview' },
  { to: '/sessions', icon: MonitorPlay, label: 'Sessions' },
  { to: '/traces', icon: GitBranch, label: 'Traces' },
  { to: '/logs', icon: ScrollText, label: 'Logs' },
  { to: '/errors', icon: AlertTriangle, label: 'Errors' },
  { to: '/settings', icon: Settings, label: 'Settings' },
] as const;

export default function Layout() {
  const { connected } = useWebSocket();
  const location = useLocation();

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-probe-surface border-r border-probe-border flex flex-col shrink-0">
        {/* Logo */}
        <div className="h-16 flex items-center gap-3 px-5 border-b border-probe-border">
          <Radio className="w-7 h-7 text-probe-accent" />
          <div>
            <h1 className="text-lg font-bold tracking-tight">Probe</h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-widest">Observability</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => {
            const isActive = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to);
            return (
              <NavLink
                key={to}
                to={to}
                className={classNames(
                  'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150',
                  isActive
                    ? 'bg-probe-accent/15 text-probe-accent-light border border-probe-accent/20'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                )}
              >
                <Icon className="w-4.5 h-4.5" />
                {label}
              </NavLink>
            );
          })}
        </nav>

        {/* Status */}
        <div className="p-4 border-t border-probe-border">
          <div className="flex items-center gap-2 text-xs">
            {connected ? (
              <>
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Connected</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-red-400" />
                <span className="text-red-400">Disconnected</span>
              </>
            )}
          </div>
          <p className="text-[10px] text-slate-600 mt-1">v0.1.0</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-[1600px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
