import { classNames, getStatusColor } from '../utils/format';

interface StatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export default function StatusBadge({ status, size = 'sm' }: StatusBadgeProps) {
  const dotClass =
    status === 'capturing' ? 'status-dot-active' :
    status === 'error' ? 'status-dot-error' :
    status === 'completed' ? 'status-dot-completed' :
    'status-dot-idle';

  return (
    <span className={classNames(
      'inline-flex items-center gap-1.5 capitalize font-medium',
      size === 'sm' ? 'text-xs' : 'text-sm',
      getStatusColor(status),
    )}>
      <span className={classNames('status-dot', dotClass)} />
      {status}
    </span>
  );
}
