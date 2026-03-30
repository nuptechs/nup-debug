import { classNames, getSourceColor, formatTimestamp, formatDuration } from '../utils/format';
import type { ProbeEvent } from '../api/client';

interface TimelineViewProps {
  events: ProbeEvent[];
  onSelect?: (event: ProbeEvent) => void;
}

export default function TimelineView({ events, onSelect }: TimelineViewProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-sm">No timeline events</p>
      </div>
    );
  }

  const startTime = new Date(events[0]!.timestamp).getTime();
  const endTime = new Date(events[events.length - 1]!.timestamp).getTime();
  const totalDuration = Math.max(endTime - startTime, 1);

  return (
    <div className="space-y-0.5">
      {/* Time axis */}
      <div className="flex items-center justify-between text-[10px] text-slate-600 px-2 mb-3">
        <span>{formatTimestamp(events[0]!.timestamp)}</span>
        <span>{formatDuration(totalDuration)}</span>
        <span>{formatTimestamp(events[events.length - 1]!.timestamp)}</span>
      </div>

      {events.map((event, i) => {
        const elapsed = new Date(event.timestamp).getTime() - startTime;
        const pct = (elapsed / totalDuration) * 100;

        return (
          <div
            key={event.id}
            onClick={() => onSelect?.(event)}
            className={classNames(
              'group flex items-center gap-3 py-1.5 px-2 rounded-md transition-all animate-slide-in',
              onSelect && 'cursor-pointer hover:bg-white/[0.03]',
            )}
            style={{ animationDelay: `${i * 20}ms` }}
          >
            {/* Timeline dot + connector */}
            <div className="relative flex flex-col items-center w-4 shrink-0">
              <div className={classNames('w-2.5 h-2.5 rounded-full border-2', getSourceDot(event.source))} />
              {i < events.length - 1 && (
                <div className="absolute top-3 w-px h-6 bg-probe-border" />
              )}
            </div>

            {/* Position bar */}
            <div className="w-24 shrink-0">
              <div className="h-1 bg-probe-border/50 rounded-full relative">
                <div
                  className={classNames('absolute h-1 rounded-full', getSourceBar(event.source))}
                  style={{ left: `${pct}%`, width: '4px' }}
                />
              </div>
            </div>

            {/* Time */}
            <span className="text-[10px] font-mono text-slate-500 w-20 shrink-0">
              {formatTimestamp(event.timestamp)}
            </span>

            {/* Source badge */}
            <span className={classNames('text-[10px] px-1.5 py-0.5 rounded border shrink-0', getSourceColor(event.source))}>
              {event.source}
            </span>

            {/* Event type + detail */}
            <span className="text-xs text-slate-300 truncate flex-1">
              <span className="font-medium">{event.type}</span>
              {event.data.url ? (
                <span className="text-slate-500 ml-2">{String(event.data.url)}</span>
              ) : null}
              {event.data.message ? (
                <span className="text-slate-500 ml-2">{String(event.data.message)}</span>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function getSourceDot(source: string): string {
  switch (source) {
    case 'browser': return 'border-violet-400 bg-violet-400/30';
    case 'network': return 'border-blue-400 bg-blue-400/30';
    case 'log': return 'border-amber-400 bg-amber-400/30';
    case 'sdk': return 'border-emerald-400 bg-emerald-400/30';
    default: return 'border-slate-400 bg-slate-400/30';
  }
}

function getSourceBar(source: string): string {
  switch (source) {
    case 'browser': return 'bg-violet-400';
    case 'network': return 'bg-blue-400';
    case 'log': return 'bg-amber-400';
    case 'sdk': return 'bg-emerald-400';
    default: return 'bg-slate-400';
  }
}
