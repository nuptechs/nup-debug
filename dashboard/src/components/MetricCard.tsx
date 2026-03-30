import type { ReactNode } from 'react';
import { classNames } from '../utils/format';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: ReactNode;
  iconColor?: string;
  subtitle?: string;
  color?: string;
  trend?: { value: number; label: string };
}

export default function MetricCard({
  title,
  value,
  change,
  changeType = 'neutral',
  icon,
  iconColor = 'text-probe-accent',
  subtitle,
  trend,
}: MetricCardProps) {
  const effectiveChange = change ?? (trend ? `${trend.value > 0 ? '+' : ''}${trend.value}% ${trend.label}` : undefined);
  const effectiveChangeType = changeType !== 'neutral' ? changeType : trend ? (trend.value > 0 ? 'positive' : 'negative') : 'neutral';
  return (
    <div className="glass-card p-5 metric-glow animate-fade-in">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{title}</p>
          <p className="text-2xl font-bold mt-1 tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          {effectiveChange && (
            <p
              className={classNames(
                'text-xs mt-2 font-medium',
                effectiveChangeType === 'positive' && 'text-emerald-400',
                effectiveChangeType === 'negative' && 'text-red-400',
                effectiveChangeType === 'neutral' && 'text-slate-400',
              )}
            >
              {effectiveChange}
            </p>
          )}
        </div>
        <div className={classNames('p-2.5 rounded-lg bg-white/5', iconColor)}>
          {icon}
        </div>
      </div>
    </div>
  );
}
