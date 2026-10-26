import type { ControlPoint } from './api'

export function groupPoints(points: ControlPoint[]) {
  const groups = new Map<string, ControlPoint[]>()
  for (const point of points) {
    if (point.error) continue
    const key = JSON.stringify([point.kind, point.datatype, point.units, point.commandable, point.labelsComplete, point.choices,
      point.units === 'unknown units' || !point.labelsComplete ? point.key : null])
    groups.set(key, [...(groups.get(key) ?? []), point])
  }
  return [...groups.values()]
}

export function valueLabel(point: ControlPoint, value: number | null) {
  if (value === null) return 'Released'
  const choice = point.choices.find((c) => c.value === value)
  return choice ? `${choice.label} · ${value}` : `${Number(value.toPrecision(7))}${point.units ? ` ${unitLabel(point.units)}` : ''}`
}

export function unitLabel(units: string) {
  return ({ 'degrees-celsius': '°C', 'degrees-fahrenheit': '°F', 'delta-degrees-kelvin': 'K', 'delta-degrees-fahrenheit': '°F', percent: '%', 'percent-relative-humidity': '%RH', 'parts-per-million': 'ppm', 'liters-per-second': 'l/s', pascals: 'Pa', 'no-units': 'no units' } as Record<string, string>)[units] ?? units.replaceAll('-', ' ')
}

/** Object types the control service can write: analog, binary and multistate outputs and values. */
export const WRITABLE_TYPES = new Set([1, 2, 4, 5, 14, 19])

/** The priority array's named levels (ASHRAE 135, 19.2.1). The rest are open for site use. */
export const PRIORITY_NAMES: Record<number, string> = {
  1: 'Manual life safety',
  2: 'Automatic life safety',
  5: 'Critical equipment control',
  6: 'Minimum on/off',
  8: 'Manual operator',
}

/** The slot in charge: the highest occupied priority, or null when the relinquish default applies. */
export function winningSlot(point: ControlPoint) {
  const i = point.slots?.findIndex((v) => v !== null) ?? -1
  return i < 0 ? null : i + 1
}
