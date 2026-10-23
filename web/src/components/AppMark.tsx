import { cn } from '../ui/utils'

/**
 * The BACon mark: a node with two broadcast arcs either side, (( • )). The node is the health light;
 * the arcs are the who-is going out. Busy: the arcs ripple outward. Degraded: the node pulses amber.
 */
export type MarkStatus = 'healthy' | 'busy' | 'degraded' | 'offline'

const NODE: Record<MarkStatus, string> = {
  healthy: 'var(--action-primary)',
  busy: 'var(--action-primary)',
  degraded: 'var(--status-warn-strong)',
  offline: 'var(--ink-4)',
}

export const MARK_STATUS_LABEL: Record<MarkStatus, string> = {
  healthy: 'Connected',
  busy: 'Working…',
  degraded: 'Some objects could not be read',
  offline: 'Not connected',
}

export function AppMark({ size = 26, status = 'healthy', className }: { size?: number; status?: MarkStatus; className?: string }) {
  return (
    <svg
      className={cn('bx-mark block shrink-0', `bx-mark-${status}`, className)}
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={`BACon, ${MARK_STATUS_LABEL[status].toLowerCase()}`}
      fill="none"
      strokeLinecap="round"
      strokeWidth={2.6}
    >
      <path className="bx-arc bx-arc-outer" d="M25.2 6.8a13 13 0 0 1 0 18.4M6.8 25.2a13 13 0 0 1 0-18.4" stroke="var(--ink-3)" />
      <path className="bx-arc bx-arc-inner" d="M21.7 10.3a8 8 0 0 1 0 11.4M10.3 21.7a8 8 0 0 1 0-11.4" stroke="var(--ink)" />
      <circle className="bx-node" cx="16" cy="16" r="3.6" fill={NODE[status]} />
    </svg>
  )
}
