import type { ControlPoint } from './api'

/** Units that measure the same thing, so one value converts between them: absolute temperatures, and differences. */
const TEMP: Record<string, { family: 'temp' | 'delta'; toC: (v: number) => number; fromC: (v: number) => number }> = {
  'degrees-celsius': { family: 'temp', toC: (v) => v, fromC: (v) => v },
  'degrees-fahrenheit': { family: 'temp', toC: (v) => (v - 32) / 1.8, fromC: (v) => v * 1.8 + 32 },
  'degrees-kelvin': { family: 'temp', toC: (v) => v - 273.15, fromC: (v) => v + 273.15 },
  'delta-degrees-kelvin': { family: 'delta', toC: (v) => v, fromC: (v) => v },
  'delta-degrees-fahrenheit': { family: 'delta', toC: (v) => v / 1.8, fromC: (v) => v * 1.8 },
}

/** A value in one unit as the same value in another (°C to °F, K to °F difference); other units pass through. */
export function convert(value: number, from: string, to: string) {
  if (from === to || !TEMP[from] || !TEMP[to] || TEMP[from].family !== TEMP[to].family) return value
  return Number(TEMP[to].fromC(TEMP[from].toC(value)).toPrecision(10))
}

/** A change by `delta` in one unit as a change in another: +1 °C is +1.8 °F, whatever the scale's zero. */
export function convertDelta(delta: number, from: string, to: string) {
  if (from === to || !TEMP[from] || !TEMP[to]) return delta
  const scale = (u: string) => (u === 'degrees-fahrenheit' || u === 'delta-degrees-fahrenheit' ? 1.8 : 1)
  return Number(((delta / scale(from)) * scale(to)).toPrecision(10))
}

/** What a point means apart from where it is: its name without the numbers that tell one AHU or zone from the next. */
export function meaningOf(name: string) {
  const words = name.toLowerCase().split(/[\s_.\-/]+/).filter(Boolean)
  const kept = words.filter((w) => !/\d/.test(w))
  return (kept.length ? kept : words).join(' ')
}

export type WriteGroup = {
  points: ControlPoint[]
  kind: ControlPoint['kind']
  /** the unit values are typed in: the most common among the points */
  units: string
  /** binary and multistate: the state labels, in the first point's order; each point keeps its own numbers */
  labels: string[] | null
}

/**
 * Points that take one value together. First by meaning (the same name on every AHU), then by what the value is: a
 * number in units that convert into each other, or the same set of state labels, whatever numbers each controller
 * uses for them. Priority commands and direct writes share a group; each point is written its own way. A point with
 * incomplete labels or unknown units is never grouped with another.
 */
export function groupPoints(points: ControlPoint[]): WriteGroup[] {
  const groups = new Map<string, ControlPoint[]>()
  for (const point of points) {
    if (point.error) continue
    const labels = point.kind === 'analog' ? null : point.choices.map((c) => c.label.trim().toLowerCase()).sort()
    const measure = point.kind === 'analog' ? (TEMP[point.units]?.family ?? point.units) : null
    const alone = point.units === 'unknown units' || (point.kind !== 'analog' && !point.labelsComplete)
    const key = JSON.stringify([meaningOf(point.name ?? ''), point.kind, measure, labels, alone ? point.key : null])
    groups.set(key, [...(groups.get(key) ?? []), point])
  }
  return [...groups.values()].map((list) => {
    const count = new Map<string, number>()
    for (const p of list) count.set(p.units, (count.get(p.units) ?? 0) + 1)
    const units = [...count].sort((a, b) => b[1] - a[1])[0][0]
    return { points: list, kind: list[0].kind, units, labels: list[0].kind === 'analog' ? null : list[0].choices.map((c) => c.label) }
  })
}

/** The number this point uses for a state label, matched without regard to case; null when it has no such state. */
export function stateFor(point: ControlPoint, label: string) {
  const want = label.trim().toLowerCase()
  return point.choices.find((c) => c.label.trim().toLowerCase() === want)?.value ?? null
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
