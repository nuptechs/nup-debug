import { classNames, getMethodColor, formatDuration } from '../utils/format';

export interface TraceSpan {
  id: string;
  name: string;
  method?: string;
  url?: string;
  status?: number;
  duration: number;
  startTime: number;
  children?: TraceSpan[];
  source: string;
  error?: boolean;
}

interface TraceWaterfallProps {
  spans: TraceSpan[];
  totalDuration: number;
}

export default function TraceWaterfall({ spans, totalDuration }: TraceWaterfallProps) {
  if (spans.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-sm">No trace spans available</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Header */}
      <div className="grid grid-cols-[300px_1fr_80px] gap-2 text-[10px] text-slate-500 uppercase tracking-wider px-3 pb-2 border-b border-probe-border">
        <span>Operation</span>
        <span>Waterfall</span>
        <span className="text-right">Duration</span>
      </div>

      {spans.map((span, i) => (
        <SpanRow key={span.id} span={span} totalDuration={totalDuration} depth={0} index={i} />
      ))}
    </div>
  );
}

function SpanRow({ span, totalDuration, depth, index }: {
  span: TraceSpan;
  totalDuration: number;
  depth: number;
  index: number;
}) {
  const left = (span.startTime / totalDuration) * 100;
  const width = Math.max((span.duration / totalDuration) * 100, 0.5);

  return (
    <>
      <div
        className="grid grid-cols-[300px_1fr_80px] gap-2 items-center px-3 py-1.5 rounded hover:bg-white/[0.02] animate-slide-in"
        style={{ animationDelay: `${index * 30}ms` }}
      >
        {/* Operation name */}
        <div className="flex items-center gap-1.5 min-w-0" style={{ paddingLeft: `${depth * 16}px` }}>
          {span.method && (
            <span className={classNames('text-[10px] font-bold shrink-0', getMethodColor(span.method))}>
              {span.method}
            </span>
          )}
          <span className="text-xs text-slate-300 truncate">
            {span.url || span.name}
          </span>
          {span.status && (
            <span className={classNames(
              'text-[10px] px-1 rounded shrink-0',
              span.status >= 400 ? 'text-red-400 bg-red-500/10' : 'text-emerald-400 bg-emerald-500/10',
            )}>
              {span.status}
            </span>
          )}
        </div>

        {/* Waterfall bar */}
        <div className="h-5 relative">
          <div className="absolute inset-0 bg-probe-border/20 rounded" />
          <div
            className={classNames(
              'absolute h-full rounded transition-all duration-300',
              span.error ? 'bg-red-500/60' : getSpanBarColor(span.source),
            )}
            style={{ left: `${left}%`, width: `${width}%` }}
          />
        </div>

        {/* Duration */}
        <span className={classNames(
          'text-xs font-mono text-right',
          span.error ? 'text-red-400' : 'text-slate-400',
        )}>
          {formatDuration(span.duration)}
        </span>
      </div>

      {span.children?.map((child, i) => (
        <SpanRow key={child.id} span={child} totalDuration={totalDuration} depth={depth + 1} index={i} />
      ))}
    </>
  );
}

function getSpanBarColor(source: string): string {
  switch (source) {
    case 'network': return 'bg-blue-500/50';
    case 'sdk': return 'bg-emerald-500/50';
    case 'browser': return 'bg-violet-500/50';
    default: return 'bg-slate-500/50';
  }
}
