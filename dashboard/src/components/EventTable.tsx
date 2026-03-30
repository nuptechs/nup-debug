import { classNames, getSourceColor, formatTimestamp, truncate } from '../utils/format';
import type { ProbeEvent } from '../api/client';

interface EventTableProps {
  events: ProbeEvent[];
  onSelect?: (event: ProbeEvent) => void;
  compact?: boolean;
}

export default function EventTable({ events, onSelect, compact = false }: EventTableProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500">
        <p className="text-sm">No events captured yet</p>
        <p className="text-xs mt-1">Events will appear here as they're ingested</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-probe-border">
            <th className="py-3 px-4 font-medium">Time</th>
            <th className="py-3 px-4 font-medium">Source</th>
            <th className="py-3 px-4 font-medium">Type</th>
            {!compact && <th className="py-3 px-4 font-medium">Details</th>}
            {!compact && <th className="py-3 px-4 font-medium">Correlation</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-probe-border/50">
          {events.map((event) => (
            <tr
              key={event.id}
              onClick={() => onSelect?.(event)}
              className={classNames(
                'transition-colors duration-100',
                onSelect && 'cursor-pointer hover:bg-white/[0.02]',
              )}
            >
              <td className="py-2.5 px-4 font-mono text-xs text-slate-400 whitespace-nowrap">
                {formatTimestamp(event.timestamp)}
              </td>
              <td className="py-2.5 px-4">
                <span className={classNames('text-xs px-2 py-0.5 rounded-full border', getSourceColor(event.source))}>
                  {event.source}
                </span>
              </td>
              <td className="py-2.5 px-4 text-slate-300">{event.type}</td>
              {!compact && (
                <td className="py-2.5 px-4 text-slate-400 font-mono text-xs max-w-xs">
                  {truncate(extractDetail(event), 100)}
                </td>
              )}
              {!compact && (
                <td className="py-2.5 px-4 text-xs font-mono text-slate-500">
                  {event.correlationId ? truncate(event.correlationId, 12) : '—'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function extractDetail(event: ProbeEvent): string {
  const d = event.data;
  if (d.method && d.url) return `${d.method as string} ${d.url as string}`;
  if (d.message) return d.message as string;
  if (d.level && d.message) return `[${d.level as string}] ${d.message as string}`;
  if (d.query) return d.query as string;
  if (d.selector) return `click: ${d.selector as string}`;
  return JSON.stringify(d).slice(0, 120);
}
