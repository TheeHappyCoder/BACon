import type { Point } from './api'

export const SHORT: Record<string, string> = {
  'analog-input': 'AI',
  'analog-output': 'AO',
  'analog-value': 'AV',
  'binary-input': 'BI',
  'binary-output': 'BO',
  'binary-value': 'BV',
  'multi-state-input': 'MSI',
  'multi-state-output': 'MSO',
  'multi-state-value': 'MSV',
  loop: 'Loop',
  schedule: 'Schedule',
  calendar: 'Calendar',
  'notification-class': 'NC',
  'trend-log': 'TL',
  'trend-log-multiple': 'TLM',
}

export const GROUPS: { title: string; types: string[] }[] = [
  { title: 'Inputs', types: ['analog-input', 'binary-input', 'multi-state-input'] },
  { title: 'Setpoints and modes', types: ['analog-value', 'binary-value', 'multi-state-value'] },
  { title: 'Outputs and control', types: ['analog-output', 'binary-output', 'multi-state-output', 'loop'] },
  { title: 'Schedules', types: ['schedule', 'calendar'] },
  { title: 'Alarms and logs', types: ['notification-class', 'trend-log', 'trend-log-multiple'] },
]

export function ago(t: number | null | undefined, now = Date.now() / 1000): string {
  if (!t) return ''
  const s = Math.max(0, Math.round(now - t))
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h} h ago`
  return `${Math.round(h / 24)} days ago`
}

export function clock(t: number): string {
  const d = new Date(t * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function when(t: number | null): string {
  if (!t) return 'never'
  const d = new Date(t * 1000)
  const today = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`
  return d.toDateString() === today.toDateString() ? `today ${hm}` : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${hm}`
}

export const isAlarming = (p: Point) => !!p.alarm && p.alarm.state !== 'normal'
export const needsAck = (p: Point) => !!p.alarm && p.alarm.acked.some((b) => !b)

export const STATE_LABEL: Record<string, string> = {
  normal: 'Normal',
  'high-limit': 'High limit',
  'low-limit': 'Low limit',
  offnormal: 'Off normal',
  fault: 'Fault',
}

/** Who did it, in words: a peer address, the room unit, or Rasher itself. */
export const who = (by: string) => (by === 'Rasher' ? 'you' : by === 'Room unit' ? 'the room unit' : by)
