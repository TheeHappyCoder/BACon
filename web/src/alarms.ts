/**
 * Alarms as BACnet keeps them: intrinsic reporting on the object itself (event-state, limits or alarm values,
 * event-enable, acked-transitions, event-time-stamps, a notification class) or an Event Enrollment object watching
 * another object. Acknowledging and changing the setup go through BACon's control service and its action log.
 */
import type { DeviceEvent, ObjectRow } from './api'
import { unitShort } from './schedule'

export type Severity = 'alarm' | 'fault' | 'normal'
export type Live = { at: number; source: string; events: DeviceEvent[]; error?: string }
export type AlarmState = {
  eventState: string
  severity: Severity
  /** to-offnormal, to-fault, to-normal: has that transition been acknowledged */
  acked: [boolean, boolean, boolean]
  /** when each transition last happened (local ms), null if never */
  stamps: [number | null, number | null, number | null]
  /** when the object entered its current state */
  since: number | null
  unacked: boolean
  /** live: from the controller's alarm list; read: from the object's own properties at the last read */
  source: 'live' | 'read'
}

const TRANSITIONS = ['to-offnormal', 'to-fault', 'to-normal'] as const
export const TRANSITION_LABEL = ['To alarm', 'To fault', 'Back to normal']

/** Objects with an alarm set up, or in a non-normal event state, plus Event Enrollment objects. */
export function isAlarmObject(r: ObjectRow) {
  if (r.typeId === 9) return true
  const state = r.values['event-state']
  if (state === undefined) return false
  if ([20, 25, 27].includes(r.typeId) && state === 'normal') return false // logs report buffer-ready events, not alarms
  return (r.values['event-enable'] ?? 'none') !== 'none' || state !== 'normal'
}

export function severityOf(eventState: string): Severity {
  if (!eventState || eventState === 'normal') return 'normal'
  if (eventState === 'fault') return 'fault'
  return 'alarm'
}

const STATE_LABEL: Record<string, string> = {
  normal: 'Normal',
  fault: 'Fault',
  offnormal: 'Off-normal',
  'high-limit': 'High limit',
  'low-limit': 'Low limit',
  'life-safety-alarm': 'Life safety alarm',
}
export const stateLabel = (s: string) => STATE_LABEL[s] ?? s.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase())

const parseStamp = (s: unknown): number | null => {
  if (typeof s !== 'string') return null
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? null : t
}

export function stateOf(r: ObjectRow, live?: Live): AlarmState {
  const reported = live?.events.find((e) => e.typeId === r.typeId && e.instance === r.instance)
  let eventState: string
  let acked: [boolean, boolean, boolean]
  let stamps: [number | null, number | null, number | null]
  let source: AlarmState['source'] = 'read'
  const readStamps = (r.detail?.['event-time-stamps'] as unknown[] | undefined) ?? []
  if (reported) {
    eventState = reported.eventState
    acked = [0, 1, 2].map((i) => reported.acked[i] ?? true) as [boolean, boolean, boolean]
    stamps = [0, 1, 2].map((i) => parseStamp(reported.stamps[i]) ?? parseStamp(readStamps[i])) as typeof stamps
    source = 'live'
  } else if (live && !live.error) {
    // the controller answered and did not list this object: it is normal and fully acknowledged
    eventState = 'normal'
    acked = [true, true, true]
    stamps = [0, 1, 2].map((i) => parseStamp(readStamps[i])) as typeof stamps
    source = 'live'
  } else {
    eventState = r.values['event-state'] ?? 'normal'
    const ackText = r.values['acked-transitions']
    acked = TRANSITIONS.map((t) => ackText === undefined || ackText.split(';').includes(t)) as [boolean, boolean, boolean]
    stamps = [0, 1, 2].map((i) => parseStamp(readStamps[i])) as typeof stamps
  }
  const severity = severityOf(eventState)
  const since = severity === 'alarm' ? stamps[0] : severity === 'fault' ? stamps[1] : stamps[2]
  return { eventState, severity, acked, stamps, since, unacked: acked.some((a) => !a), source }
}

/** What sets the alarm off, in words, from the object's own setup. */
export function conditionText(r: ObjectRow, rowsByKey: Map<string, ObjectRow>): string {
  const v = r.values
  const u = unitShort(v.units ?? '')
  const withUnit = (x: string) => (u ? `${x}${u.startsWith('°') || u === '%' ? '' : ' '}${u}` : x)
  if (r.typeId === 9) {
    const ref = v['object-property-reference'] ?? ''
    const m = ref.match(/objectIdentifier=([\w-]+),(\d+)/)
    const target = m ? [...rowsByKey.values()].find((x) => x.device === r.device && x.values['Object type'] === m[1] && x.instance === Number(m[2])) : undefined
    const kind = stateLabel(v['event-type'] ?? 'event')
    return `${kind} on ${target?.values['object-name'] || (m ? `${m[1]} ${m[2]}` : 'another object')}`
  }
  if (v['high-limit'] !== undefined || v['low-limit'] !== undefined) {
    const enabled = v['limit-enable'] ?? 'low-limit-enable;high-limit-enable'
    const parts: string[] = []
    if (enabled.includes('high-limit-enable') && v['high-limit'] !== undefined) parts.push(`above ${withUnit(v['high-limit'])}`)
    if (enabled.includes('low-limit-enable') && v['low-limit'] !== undefined) parts.push(`below ${withUnit(v['low-limit'])}`)
    if (!parts.length) return 'Limits set, but both are switched off'
    const text = parts.join(' or ')
    return text[0].toUpperCase() + text.slice(1)
  }
  if (v['alarm-value'] !== undefined) {
    const val = v['alarm-value']
    const label = val === 'active' ? v['active-text'] || 'active' : val === 'inactive' ? v['inactive-text'] || 'inactive' : val
    return `When ${label}`
  }
  if (v['alarm-values'] !== undefined) {
    const states = (v['state-text'] ?? '').split('; ')
    const list = v['alarm-values'].split('; ').map((n) => states[Number(n) - 1] || n)
    return `When ${list.join(' or ')}`
  }
  if (v['fault-values'] !== undefined) return 'On fault values'
  return v['event-detection-enable'] === 'false' ? 'Detection switched off' : 'Set up by the controller'
}

/** The notification class an object reports through, found among the rows of the same device. */
export function notificationClassOf(r: ObjectRow, rows: ObjectRow[]) {
  const n = r.values['notification-class']
  if (n === undefined) return undefined
  return rows.find((x) => x.typeId === 15 && x.device === r.device && (x.values['notification-class'] === n || String(x.instance) === n))
}

export function clock(ms: number) {
  const d = new Date(ms)
  const today = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
  if (d.toDateString() === today.toDateString()) return time
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

/** "40 min ago", "3 h ago", "2 days ago" */
export function ago(t: number, now = Date.now()) {
  const s = Math.round((now - t) / 1000)
  if (s < 0) return 'just now'
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
