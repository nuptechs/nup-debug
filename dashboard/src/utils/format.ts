export function formatDuration(ms: number): string {
  if (ms < 1) return '<1ms';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor((ms % 3_600_000) / 60_000)}m`;
}

export function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour12: false, fractionalSecondDigits: 3 });
}

export function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1_073_741_824) return `${(bytes / 1_048_576).toFixed(1)}MB`;
  return `${(bytes / 1_073_741_824).toFixed(1)}GB`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function truncate(str: string, max: number = 80): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

export function classNames(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'capturing': return 'text-emerald-400';
    case 'completed': return 'text-blue-400';
    case 'error': return 'text-red-400';
    case 'paused': return 'text-amber-400';
    default: return 'text-slate-400';
  }
}

export function getSourceColor(source: string): string {
  switch (source) {
    case 'browser': return 'bg-violet-500/20 text-violet-300 border-violet-500/30';
    case 'network': return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
    case 'log': return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
    case 'sdk': return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
    default: return 'bg-slate-500/20 text-slate-300 border-slate-500/30';
  }
}

export function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'text-emerald-400';
    case 'POST': return 'text-blue-400';
    case 'PUT': return 'text-amber-400';
    case 'PATCH': return 'text-orange-400';
    case 'DELETE': return 'text-red-400';
    default: return 'text-slate-400';
  }
}

export function getLogLevelColor(level: string): string {
  switch (level.toLowerCase()) {
    case 'fatal': case 'error': return 'text-red-400 bg-red-500/10';
    case 'warn': case 'warning': return 'text-amber-400 bg-amber-500/10';
    case 'info': return 'text-blue-400 bg-blue-500/10';
    case 'debug': return 'text-slate-400 bg-slate-500/10';
    case 'trace': return 'text-slate-500 bg-slate-500/5';
    default: return 'text-slate-400';
  }
}
