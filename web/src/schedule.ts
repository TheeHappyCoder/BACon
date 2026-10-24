/**
 * BACnet Schedule objects, evaluated the way a controller does (ASHRAE 135, clause 12.24):
 * for each minute of a day, every matching exception (special event) and the weekly schedule is a layer; a layer is
 * active from one of its entries until the next, and an entry whose value is null releases it. The active layer with
 * the best (lowest) priority wins, the weekly schedule being the weakest; with no active layer the schedule-default
 * applies. Outside the effective period the schedule does not run at all.
 */
import type { ObjectRow } from './api'

export type SValue = { type: 'null' | 'boolean' | 'enumerated' | 'unsigned' | 'integer' | 'real' | 'string' | 'other'; value: number | boolean | string | null }
/** [year, month, day, weekday 1=Mon..7=Sun]; null is a wildcard. Month 13/14 = odd/even, day 32/33/34 = last/odd/even. */
export type BDate = [number | null, number | null, number | null, number | null]
export type TimeValue = { time: string | null; value: SValue }
export type CalendarEntry = { date: BDate } | { range: [BDate, BDate] } | { weekNDay: [number | null, number | null, number | null] }
export type Period = CalendarEntry | { calendar: [number, number] }
export type SpecialEvent = { period: Period | null; times: TimeValue[]; priority: number }
export type ObjRef = { object: [number, number]; property: string; device: number | null }

export type Schedule = {
  row: ObjectRow
  weekly: TimeValue[][] | null
  exceptions: SpecialEvent[]
  effective: [BDate, BDate] | null
  fallback: SValue | null
  refs: ObjRef[]
}

/** One stretch of a day with one value. source: the weekly schedule, an exception (its index), the default, or off. */
export type Segment = { start: number; end: number; value: SValue | null; source: 'weekly' | 'default' | 'off' | number }

export const DAY_MIN = 24 * 60
const WEEKLY_PRIORITY = 17

export function readSchedule(row: ObjectRow): Schedule {
  const d = (row.detail ?? {}) as Record<string, unknown>
  return {
    row,
    weekly: Array.isArray(d['weekly-schedule']) ? (d['weekly-schedule'] as TimeValue[][]) : null,
    exceptions: Array.isArray(d['exception-schedule']) ? (d['exception-schedule'] as SpecialEvent[]) : [],
    effective: Array.isArray(d['effective-period']) ? (d['effective-period'] as [BDate, BDate]) : null,
    fallback: (d['schedule-default'] as SValue | undefined) ?? null,
    refs: Array.isArray(d['list-of-object-property-references']) ? (d['list-of-object-property-references'] as ObjRef[]) : [],
  }
}

export const minutesOf = (time: string | null) => {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}
export const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

const weekday = (d: Date) => ((d.getDay() + 6) % 7) + 1 // 1 = Monday
const lastDay = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
const dayKey = (d: Date) => d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()

export function matchDate(d: Date, [y, m, day, dow]: BDate) {
  if (y !== null && y !== d.getFullYear()) return false
  const month = d.getMonth() + 1
  if (m !== null && !(m === 13 ? month % 2 === 1 : m === 14 ? month % 2 === 0 : m === month)) return false
  const dd = d.getDate()
  if (day !== null && !(day === 32 ? dd === lastDay(d) : day === 33 ? dd % 2 === 1 : day === 34 ? dd % 2 === 0 : day === dd)) return false
  if (dow !== null && dow !== weekday(d)) return false
  return true
}

/** A range end as a comparable day number; wildcards open the range (a fully unspecified end is unbounded). */
function bound(b: BDate, end: boolean): number {
  const [y, m, d] = b
  if (y === null && m === null && d === null) return end ? Infinity : -Infinity
  const year = y ?? (end ? 9999 : 0)
  const month = m === null || m > 12 ? (end ? 12 : 1) : m
  const day = d === null || d > 31 ? (end ? 31 : 1) : d
  return year * 10000 + month * 100 + day
}

export function inRange(d: Date, [a, b]: [BDate, BDate]) {
  const k = dayKey(d)
  return k >= bound(a, false) && k <= bound(b, true)
}

export function matchWeekNDay(d: Date, [m, week, dow]: [number | null, number | null, number | null]) {
  const month = d.getMonth() + 1
  if (m !== null && !(m === 13 ? month % 2 === 1 : m === 14 ? month % 2 === 0 : m === month)) return false
  if (dow !== null && dow !== weekday(d)) return false
  if (week === null) return true
  const dd = d.getDate()
  const last = lastDay(d)
  if (week >= 1 && week <= 5) return dd >= (week - 1) * 7 + 1 && dd <= week * 7
  if (week >= 6 && week <= 9) {
    const back = (week - 6) * 7 // 6: the last 7 days, 7: the 7 before those, ...
    return dd <= last - back && dd > last - back - 7
  }
  return false
}

export function matchEntry(d: Date, e: CalendarEntry) {
  if ('date' in e) return matchDate(d, e.date)
  if ('range' in e) return inRange(d, e.range)
  return matchWeekNDay(d, e.weekNDay)
}

/** calendars: "device:instance" -> the calendar's date-list */
export type Calendars = Map<string, { name: string; entries: CalendarEntry[] }>

export function matchPeriod(d: Date, p: Period | null, device: number, calendars: Calendars) {
  if (!p) return false
  if ('calendar' in p) {
    const cal = calendars.get(`${device}:${p.calendar[1]}`)
    return !!cal && cal.entries.some((e) => matchEntry(d, e))
  }
  return matchEntry(d, p)
}

export const inEffect = (s: Schedule, d: Date) => !s.effective || inRange(d, s.effective)

/** The day's segments, start to end, with which layer each value comes from. */
export function daySegments(s: Schedule, d: Date, calendars: Calendars): Segment[] {
  if (!inEffect(s, d)) return [{ start: 0, end: DAY_MIN, value: null, source: 'off' }]
  type Layer = { priority: number; order: number; source: Segment['source']; entries: { at: number; value: SValue }[] }
  const layers: Layer[] = []
  const toEntries = (times: TimeValue[]) =>
    times
      .map((t) => ({ at: minutesOf(t.time), value: t.value }))
      .filter((t): t is { at: number; value: SValue } => t.at !== null)
      .sort((a, b) => a.at - b.at)
  s.exceptions.forEach((ex, i) => {
    if (matchPeriod(d, ex.period, s.row.device, calendars)) layers.push({ priority: ex.priority || 16, order: i, source: i, entries: toEntries(ex.times) })
  })
  const week = s.weekly?.[weekday(d) - 1]
  if (week) layers.push({ priority: WEEKLY_PRIORITY, order: Infinity, source: 'weekly', entries: toEntries(week) })
  layers.sort((a, b) => a.priority - b.priority || a.order - b.order)

  // only entry times can change the winner, so evaluate at those and fill the stretches between
  const cuts = [...new Set([0, ...layers.flatMap((l) => l.entries.map((e) => e.at)), DAY_MIN])].sort((a, b) => a - b)
  const out: Segment[] = []
  for (let i = 0; i < cuts.length - 1; i++) {
    const at = cuts[i]
    let pick: Segment = { start: at, end: cuts[i + 1], value: s.fallback, source: 'default' }
    for (const l of layers) {
      let active: SValue | null = null
      for (const e of l.entries) if (e.at <= at) active = e.value
      if (active && active.type !== 'null') {
        pick = { start: at, end: cuts[i + 1], value: active, source: l.source }
        break
      }
    }
    const prev = out[out.length - 1]
    if (prev && prev.source === pick.source && sameValue(prev.value, pick.value)) prev.end = pick.end
    else out.push(pick)
  }
  return out
}

export const sameValue = (a: SValue | null, b: SValue | null) => (a?.value ?? null) === (b?.value ?? null) && (a?.type === 'null') === (b?.type === 'null')

export function segmentAt(segments: Segment[], minute: number) {
  return segments.find((x) => minute >= x.start && minute < x.end) ?? segments[segments.length - 1]
}

/** The value now and the next time it changes, looking up to 8 days ahead. */
export function nowAndNext(s: Schedule, calendars: Calendars, now = new Date()) {
  const minute = now.getHours() * 60 + now.getMinutes()
  const today = daySegments(s, now, calendars)
  const current = segmentAt(today, minute)
  for (let day = 0; day < 8; day++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day)
    const segs = day === 0 ? today : daySegments(s, d, calendars)
    for (const seg of segs) {
      if (day === 0 && seg.start <= minute) continue
      if (seg.source === 'off' && current.source === 'off') continue
      if (!sameValue(seg.value, current.value) || (seg.source === 'off') !== (current.source === 'off')) {
        return { current, next: { at: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, seg.start), segment: seg } }
      }
    }
  }
  return { current, next: null }
}

// ---- words ---------------------------------------------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const ORD = ['', '1st', '2nd', '3rd', '4th', '5th']

export function describeDate([y, m, d, dow]: BDate) {
  if (y === null && m === null && d === null && dow === null) return 'Any day'
  const parts: string[] = []
  if (dow !== null) parts.push(DAYS[dow - 1])
  if (d !== null) parts.push(d === 32 ? 'last day' : d === 33 ? 'odd days' : d === 34 ? 'even days' : String(d))
  if (m !== null) parts.push(m === 13 ? 'of odd months' : m === 14 ? 'of even months' : MONTHS[m - 1].slice(0, 3))
  else if (d !== null) parts.push('of every month')
  parts.push(y === null ? (m !== null || d !== null ? 'every year' : '') : String(y))
  return parts.filter(Boolean).join(' ')
}

export function describeEntry(e: CalendarEntry) {
  if ('date' in e) return describeDate(e.date)
  if ('range' in e) {
    const [a, b] = e.range
    if (a.every((x) => x === null) && b.every((x) => x === null)) return 'Always'
    return `${a.every((x) => x === null) ? 'Until' : describeDate(a)} – ${b.every((x) => x === null) ? 'onwards' : describeDate(b)}`
  }
  const [m, w, dow] = e.weekNDay
  const which = w === null ? 'Every' : w <= 5 ? `${ORD[w]}` : w === 6 ? 'Last' : `${w - 5}${['', '', 'nd', 'rd', 'th'][w - 5] ?? 'th'} to last`
  const day = dow === null ? 'day' : DAYS[dow - 1]
  const month = m === null ? 'of every month' : m === 13 ? 'of odd months' : m === 14 ? 'of even months' : `in ${MONTHS[m - 1]}`
  return `${which} ${day} ${month}`
}

export function describePeriod(p: Period | null, device: number, calendars: Calendars) {
  if (!p) return 'Unknown dates'
  if ('calendar' in p) return calendars.get(`${device}:${p.calendar[1]}`)?.name ?? `Calendar ${p.calendar[1]}`
  return describeEntry(p)
}

/** A short name for an exception on a calendar block: the calendar's name, or what kind of date it is. */
export function exceptionName(p: Period | null, device: number, calendars: Calendars) {
  if (!p) return 'Exception'
  if ('calendar' in p) return calendars.get(`${device}:${p.calendar[1]}`)?.name ?? `Calendar ${p.calendar[1]}`
  if ('weekNDay' in p) return describeEntry(p)
  return 'range' in p ? 'Date range' : 'Special day'
}

export const describeEffective = (s: Schedule) => (s.effective ? describeEntry({ range: s.effective }) : 'Always')

// ---- values: what the numbers mean for the points the schedule drives ------------------------------------------------

export type ValueContext = { kind: 'binary' | 'multistate' | 'analog' | 'other'; active: string; inactive: string; states: string[]; units: string }

const UNIT_SHORT: Record<string, string> = {
  'degrees-celsius': '°C',
  'degrees-fahrenheit': '°F',
  'degrees-kelvin': 'K',
  percent: '%',
  'percent-relative-humidity': '%RH',
  pascals: 'Pa',
  kilopascals: 'kPa',
  'parts-per-million': 'ppm',
  'liters-per-second': 'l/s',
  'cubic-meters-per-hour': 'm³/h',
  kilowatts: 'kW',
  watts: 'W',
  hertz: 'Hz',
  seconds: 's',
  minutes: 'min',
  hours: 'h',
}
export const unitShort = (u: string) => (u && u !== 'no-units' ? UNIT_SHORT[u] ?? u : '')

export function valueContext(s: Schedule, rowsByKey: Map<string, ObjectRow>): ValueContext {
  const ref = s.refs[0]
  const target = ref ? rowsByKey.get(`${ref.device ?? s.row.device}:${ref.object[0]},${ref.object[1]}`) : undefined
  const t = ref?.object[0]
  const v = target?.values ?? {}
  const kind = t === undefined ? 'other' : [3, 4, 5].includes(t) ? 'binary' : [13, 14, 19].includes(t) ? 'multistate' : [0, 1, 2].includes(t) ? 'analog' : 'other'
  const states = (v['state-text'] ?? '').split('; ').filter(Boolean)
  return { kind, active: v['active-text'] || 'Active', inactive: v['inactive-text'] || 'Inactive', states, units: v.units ?? '' }
}

export function valueLabel(v: SValue | null, ctx: ValueContext) {
  if (!v || v.type === 'null') return 'Release'
  if (v.type === 'boolean') return v.value ? 'True' : 'False'
  const n = typeof v.value === 'number' ? v.value : Number(v.value)
  if (ctx.kind === 'binary' && (v.type === 'enumerated' || v.type === 'unsigned') && (n === 0 || n === 1)) return n ? ctx.active : ctx.inactive
  if (ctx.kind === 'multistate' && Number.isInteger(n)) return ctx.states[n - 1] || `State ${n}`
  if (v.type === 'real' || v.type === 'unsigned' || v.type === 'integer' || v.type === 'enumerated') {
    const u = unitShort(ctx.units)
    return `${Number(n.toPrecision(6))}${u ? (u.startsWith('°') || u === '%' ? u : ` ${u}`) : ''}`
  }
  return String(v.value)
}

// Novacore's schedule event colours: the swatch, and the lighter fill a block is drawn with
export const SWATCH = ['#c6f56f', '#f9eb57', '#83e7ee', '#a8bdf1', '#ffb9a2', '#c4c4c4']
const FILL: Record<string, string> = { '#c6f56f': '#c6f56f', '#f9eb57': '#fdf7bc', '#83e7ee': '#cdf5f8', '#ffb9a2': '#ffe3d9', '#a8bdf1': '#e8eefc', '#c4c4c4': '#f0f0f0' }
export const fillOf = (swatch: string) => FILL[swatch] ?? swatch

/** A colour per distinct value: on is lime and off grey; states and set points take the palette in order. */
export function colorScale(values: (SValue | null)[], ctx: ValueContext) {
  const keys = [...new Set(values.filter((v) => v && v.type !== 'null').map((v) => String(v!.value)))]
  const map = new Map<string, string>()
  const ladder = SWATCH.filter((c) => c !== '#ffb9a2') // coral means critical in Novacore; schedule values never get it
  if (ctx.kind === 'binary') {
    for (const k of keys) map.set(k, k === '1' || k === 'true' ? SWATCH[0] : SWATCH[5])
  } else if (ctx.kind === 'multistate') {
    for (const k of keys) map.set(k, ladder[(((Number(k) - 1) % ladder.length) + ladder.length) % ladder.length] ?? SWATCH[3])
  } else {
    const numeric = keys.every((k) => !Number.isNaN(Number(k)))
    const sorted = numeric ? [...keys].sort((a, b) => Number(b) - Number(a)) : keys
    sorted.forEach((k, i) => map.set(k, ladder[Math.min(i, ladder.length - 1)]))
  }
  return (v: SValue | null) => (v && v.type !== 'null' ? map.get(String(v.value)) ?? SWATCH[3] : 'transparent')
}

export function calendarsOf(rows: ObjectRow[]): Calendars {
  const out: Calendars = new Map()
  for (const r of rows) {
    if (r.typeId !== 6) continue
    const entries = (r.detail?.['date-list'] as CalendarEntry[] | undefined) ?? []
    out.set(`${r.device}:${r.instance}`, { name: r.values['object-name'] || `Calendar ${r.instance}`, entries })
  }
  return out
}

export function startOfWeek(d: Date) {
  const s = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  s.setDate(s.getDate() - (weekday(s) - 1))
  return s
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b)
