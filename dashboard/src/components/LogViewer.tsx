import { useState } from 'react';
import { Search, Filter } from 'lucide-react';
import { classNames, getLogLevelColor, formatTimestamp } from '../utils/format';

interface LogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
  source?: string;
  metadata?: Record<string, unknown>;
}

interface LogViewerProps {
  logs: LogEntry[];
  onSearch?: (query: string) => void;
  onFilterLevel?: (level: string | null) => void;
}

const LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace'];

export default function LogViewer({ logs, onSearch, onFilterLevel }: LogViewerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeLevel, setActiveLevel] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    onSearch?.(q);
  };

  const handleLevel = (level: string) => {
    const newLevel = activeLevel === level ? null : level;
    setActiveLevel(newLevel);
    onFilterLevel?.(newLevel);
  };

  const filtered = logs.filter((log) => {
    if (activeLevel && log.level.toLowerCase() !== activeLevel) return false;
    if (searchQuery && !log.message.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="space-y-3">
      {/* Search + filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search logs..."
            className="w-full bg-probe-surface border border-probe-border rounded-lg pl-10 pr-4 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-probe-accent/50"
          />
        </div>
        <div className="flex items-center gap-1">
          <Filter className="w-4 h-4 text-slate-500 mr-1" />
          {LEVELS.map((level) => (
            <button
              key={level}
              onClick={() => handleLevel(level)}
              className={classNames(
                'px-2 py-1 rounded text-[10px] font-medium uppercase transition-colors',
                activeLevel === level
                  ? getLogLevelColor(level)
                  : 'text-slate-500 hover:text-slate-300',
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      {/* Log entries */}
      <div className="space-y-0.5 font-mono text-xs max-h-[600px] overflow-auto">
        {filtered.map((log) => (
          <div key={log.id}>
            <div
              onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
              className="flex items-start gap-3 px-3 py-1.5 hover:bg-white/[0.02] rounded cursor-pointer"
            >
              <span className="text-slate-500 whitespace-nowrap flex-shrink-0">
                {formatTimestamp(log.timestamp)}
              </span>
              <span className={classNames(
                'px-1.5 py-0.5 rounded text-[10px] font-bold uppercase flex-shrink-0 w-12 text-center',
                getLogLevelColor(log.level),
              )}>
                {log.level}
              </span>
              <span className="text-slate-300 break-all">{log.message}</span>
              {log.source && (
                <span className="text-slate-600 flex-shrink-0 ml-auto">{log.source}</span>
              )}
            </div>
            {expandedId === log.id && log.metadata && (
              <pre className="ml-24 px-3 py-2 text-[10px] text-slate-500 bg-probe-bg/50 rounded mb-1 overflow-auto">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            )}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="py-8 text-center text-slate-500">No logs matching criteria</div>
        )}
      </div>
    </div>
  );
}
