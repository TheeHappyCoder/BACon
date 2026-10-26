/** What BACon did, and putting it back: shared by the drawer, the Activity view and release-all. */
import { api, type ControlAction, type ObjectRow } from './api'
import { unitLabel } from './control'
import { formatField, type FieldShape } from './fields'

type Target = { key: string; device: number; typeId: number; instance: number }
type Outcome = { state: string; message: string }

/** Release one priority slot, reviewed fresh so a slot that moved on is refused rather than overwritten. */
export async function releaseSlot(target: Target, priority: number): Promise<Outcome> {
  const [point] = await api.controlPrepare([target as ObjectRow])
  if (!point || point.error) return { state: 'error', message: point?.error ?? 'Could not read the point.' }
  return api.controlWrite(point.token, null, priority, true)
}

/** Put back what an action changed: the slot as it was (released if it was empty), or the property's old value. */
export async function undoAction(a: ControlAction): Promise<Outcome> {
  if (a.property === 'acknowledge') return { state: 'error', message: 'An acknowledgement cannot be undone.' }
  if (a.property === 'present-value') {
    const [point] = await api.controlPrepare([a as unknown as ObjectRow])
    if (!point || point.error) return { state: 'error', message: point?.error ?? 'Could not read the point.' }
    if (a.priority) {
      const old = a.slotBefore ?? null
      return api.controlWrite(point.token, old, a.priority, old === null)
    }
    return api.controlWrite(point.token, a.before as number, null, false)
  }
  const [field] = await api.fieldPrepare([a], a.property)
  if (!field || field.error) return { state: 'error', message: field?.error ?? 'Could not read the property.' }
  return api.fieldWrite(field.token, a.before)
}

/** What an action asked for, in words. */
export function actionValue(a: ControlAction, value: unknown, shape: (a: ControlAction) => FieldShape = shapeOfAction): string {
  if (a.property === 'acknowledge') return `Acknowledged ${String(a.value).replace(/-/g, ' ')}`
  if (a.property === 'present-value') {
    if (value === null || value === undefined) return 'Released'
    const choice = a.choices?.find((c) => c.value === value)
    if (choice) return choice.label
    return `${Number((value as number).toPrecision(7))}${a.units && a.units !== 'no-units' ? ` ${unitLabel(a.units)}` : ''}`
  }
  return formatField(shape(a), value)
}

const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
/** For a schedule's week, which days an action changed, rather than how many entries there are. */
export function weekChange(a: ControlAction): string | null {
  if (a.kind !== 'weekly' || !Array.isArray(a.before) || !Array.isArray(a.value)) return null
  const days = DAY.filter((_, i) => JSON.stringify((a.before as unknown[])[i]) !== JSON.stringify((a.value as unknown[])[i]))
  return days.length ? `${days.join(', ')} changed` : 'no day changed'
}

export const shapeOfAction = (a: ControlAction): FieldShape => ({ kind: a.kind as FieldShape['kind'], choices: a.choices, bits: a.bits })

const LABELS: Record<string, string> = {
  'present-value': 'Present value', 'cov-increment': 'COV increment', 'min-pres-value': 'Minimum value', 'max-pres-value': 'Maximum value',
  'out-of-service': 'Out of service', 'priority-for-writing': 'Writes at priority', 'schedule-default': 'Default value',
  'effective-period': 'In effect', 'weekly-schedule': 'Week', 'exception-schedule': 'Exceptions', 'date-list': 'Dates',
  'ack-required': 'Acknowledgement needed', 'priority': 'Priorities (alarm, fault, normal)', 'log-interval': 'Log interval (1/100 s)',
  'time-delay': 'Time delay (s)', 'time-delay-normal': 'Delay back to normal (s)', 'notify-type': 'Reported as',
  'event-detection-enable': 'Event detection', 'event-enable': 'Report transitions', 'limit-enable': 'Limits enabled', 'alarm-value': 'Alarm when', 'inactive-text': 'Inactive text', 'active-text': 'Active text', 'state-text': 'State texts',
}
export const propertyLabel = (p: string | undefined) => (p ? (LABELS[p] ?? p[0].toUpperCase() + p.slice(1).replace(/-/g, ' ')) : 'Present value')
