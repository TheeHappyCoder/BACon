import type { ObjectRow } from './api'
import { num } from './query'

export type TriageId = 'fault' | 'alarm' | 'commanded' | 'outOfService' | 'unreadable' | 'outsideLimits'

/** One of the set flags in status-flags ("in-alarm, fault", or "none"). */
export const hasFlag = (r: ObjectRow, flag: string) => (r.values['status-flags'] ?? '').split(/[,;\s]+/).includes(flag)

/** The object's own word that something is broken: its fault flag, its reliability, or an event state of fault. */
export const inFault = (r: ObjectRow) => {
  const reliability = r.values.reliability
  return hasFlag(r, 'fault') || (reliability !== undefined && reliability !== 'no-fault-detected') || r.values['event-state'] === 'fault'
}

/** In an event state other than normal, fault aside (that is a fault). */
export const inAlarm = (r: ObjectRow) => {
  const state = r.values['event-state']
  return state !== undefined && state !== 'normal' && state !== 'fault'
}

/** Something holds a slot of the priority array. Empty slots read as null. */
export const commanded = (r: ObjectRow) => {
  const slots = r.values['priority-array']
  return slots !== undefined && slots.split('; ').some((s) => s.trim() !== '' && s.trim() !== 'null')
}

const outsideLimits = (r: ObjectRow) => {
  const pv = num(r.values['present-value'] ?? '')
  if (pv === null) return false
  const high = num(r.values['high-limit'] ?? '')
  const low = num(r.values['low-limit'] ?? '')
  return (high !== null && pv > high) || (low !== null && pv < low)
}

/** What is wrong in a scope, in the order the strip shows it. */
export const TRIAGE: { id: TriageId; label: string; tone: 'alarm' | 'warn' | 'info'; test: (r: ObjectRow) => boolean }[] = [
  { id: 'fault', label: 'in fault', tone: 'alarm', test: inFault },
  { id: 'alarm', label: 'in alarm', tone: 'alarm', test: inAlarm },
  { id: 'commanded', label: 'commanded', tone: 'info', test: commanded },
  { id: 'outOfService', label: 'out of service', tone: 'warn', test: (r) => r.values['out-of-service'] === 'true' },
  { id: 'unreadable', label: 'unreadable', tone: 'warn', test: (r) => r.status !== 'ok' },
  { id: 'outsideLimits', label: 'outside limits', tone: 'warn', test: outsideLimits },
]

const TESTS = Object.fromEntries(TRIAGE.map((t) => [t.id, t.test])) as Record<TriageId, (r: ObjectRow) => boolean>

/** A row passes when it matches every active chip. */
export const passesTriage = (r: ObjectRow, active: Set<TriageId>) => [...active].every((id) => TESTS[id](r))

export type Mark = { label: string; className: string; title?: string }

/** What the object says about itself beside its value, in order. BACon's own slots replace the generic commanded. */
export function valueMarkers(row: ObjectRow, held?: { priority: number | null }[]): Mark[] {
  const out: Mark[] = []
  if (inFault(row)) out.push({ label: 'fault', className: 'bg-(--status-alarm-bg)' })
  if (inAlarm(row)) out.push({ label: 'alarm', className: 'bg-(--status-alarm-bg)' })
  if (row.values['out-of-service'] === 'true') out.push({ label: 'out of service', className: 'bg-(--status-warn-bg)' })
  if (hasFlag(row, 'overridden')) out.push({ label: 'overridden', className: 'bg-(--status-warn-bg)' })
  const slots = (held ?? []).map((h) => h.priority).filter((p): p is number => p !== null)
  if (slots.length) out.push({ label: `P${slots.join(', P')}`, className: 'bg-(--status-info-bg)', title: 'BACon commanded this point and has not released it' })
  else if (commanded(row)) out.push({ label: 'commanded', className: 'bg-(--surface-track) text-(--text-muted)', title: 'Something holds a priority slot' })
  return out
}

export function triageCounts(rows: ObjectRow[]): Record<TriageId, number> {
  const counts = Object.fromEntries(TRIAGE.map((t) => [t.id, 0])) as Record<TriageId, number>
  for (const r of rows) for (const t of TRIAGE) if (t.test(r)) counts[t.id]++
  return counts
}
