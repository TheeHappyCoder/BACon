/**
 * The Rasher mark: a wall unit (rounded square) with BACon's node inside and one arc answering back. The node is the
 * device's state: blue online, amber while it restarts or ignores requests, grey when stopped.
 */
export type MarkState = 'online' | 'degraded' | 'stopped'

const NODE: Record<MarkState, string> = {
  online: 'var(--action-primary)',
  degraded: 'var(--status-warn-strong)',
  stopped: 'var(--ink-4)',
}

export function RasherMark({ size = 26, state = 'online', light = false }: { size?: number; state?: MarkState; light?: boolean }) {
  const ink = light ? '#ffffff' : 'var(--ink)'
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={`Rasher, ${state}`} fill="none" strokeLinecap="round" className="block shrink-0">
      <rect x="3.5" y="3.5" width="25" height="25" rx="8" stroke={ink} strokeWidth="2.6" />
      <path d="M17.2 11.4a6.4 6.4 0 0 1 0 9.2" stroke={light ? 'rgb(255 255 255 / 0.55)' : 'var(--ink-3)'} strokeWidth="2.4" />
      <circle cx="12.8" cy="16" r="3.2" fill={NODE[state]} style={{ transition: 'fill 0.35s cubic-bezier(0.2,0.8,0.2,1)' }} />
    </svg>
  )
}
