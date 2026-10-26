import { useEffect, useMemo, useState } from 'react'
import { api, type ControlField, type FieldResult, type ObjectRow } from '../api'
import { DAY_MIN, describeEntry, describePeriod, fillOf, hhmm, minutesOf, valueLabel, type BDate, type CalendarEntry, type Calendars, type SpecialEvent, type SValue, type TimeValue, type ValueContext } from '../schedule'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { ScrollArea } from '../ui/components/scroll-area'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { cn } from '../ui/utils'
import { useControl } from './ControlState'

const { Plus, XIcon, Copy } = Hugeicons
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

type Prop = 'weekly-schedule' | 'exception-schedule' | 'schedule-default'
type Live = { field: ControlField; calendar?: ObjectRow }
type Change = { label: string; detail: string; field: ControlField; value: unknown }

/** The atomic type the controller uses for this schedule's values, so what BACon writes matches what is there. */
function valueType(week: TimeValue[][], fallback: SValue | null, ctx: ValueContext): SValue['type'] {
  const seen = [fallback, ...week.flat().map((t) => t.value)].find((v) => v && v.type !== 'null' && v.type !== 'other')
  if (seen) return seen.type
  return ctx.kind === 'binary' ? 'enumerated' : ctx.kind === 'multistate' ? 'unsigned' : 'real'
}

/** Entries as the controller keeps them: full times, sorted, numbers as numbers. Null when one cannot be sent. */
function clean(entries: TimeValue[]): TimeValue[] | null {
  const out: TimeValue[] = []
  for (const e of entries) {
    if (!e.time) return null
    const v = e.value
    if (v.type !== 'null' && v.type !== 'boolean' && v.type !== 'string') {
      const n = Number(v.value)
      if (v.value === '' || v.value === null || !Number.isFinite(n)) return null
      out.push({ time: `${e.time.slice(0, 5)}:00`, value: { type: v.type, value: n } })
    } else out.push({ time: `${e.time.slice(0, 5)}:00`, value: v })
  }
  return out.sort((a, b) => (a.time! < b.time! ? -1 : 1))
}

/**
 * Edit a schedule the way it runs: the week, its exceptions, the default, and the dates of the calendars its
 * exceptions use. Each property is read live when editing starts and written only if it changed, checked against
 * that read, and read back. Everything goes to Activity.
 */
export function ScheduleEditor({ row, ctx, color, calendars, rowsByKey, onClose, onSaved }: {
  row: ObjectRow
  ctx: ValueContext
  color: (v: SValue | null) => string
  calendars: Calendars
  rowsByKey: Map<string, ObjectRow>
  onClose: () => void
  onSaved: (calendarRefs: [number, number][]) => void
}) {
  const control = useControl()
  const [live, setLive] = useState<Partial<Record<Prop | 'date-list', Live[]>>>({})
  const [week, setWeek] = useState<TimeValue[][]>([])
  const [exceptions, setExceptions] = useState<SpecialEvent[]>([])
  const [fallback, setFallback] = useState<SValue | null>(null)
  const [dates, setDates] = useState<Record<string, CalendarEntry[]>>({})
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [review, setReview] = useState<Change[] | null>(null)
  const [results, setResults] = useState<(FieldResult | { state: 'error'; message: string; property: string })[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const fields: Partial<Record<Prop | 'date-list', Live[]>> = {}
        for (const prop of ['weekly-schedule', 'exception-schedule', 'schedule-default'] as Prop[]) {
          const [f] = await api.fieldPrepare([row], prop)
          if (f && !f.error) fields[prop] = [{ field: f }]
        }
        // the calendars its exceptions use, on the same device
        const exs = (fields['exception-schedule']?.[0].field.current as SpecialEvent[] | undefined) ?? []
        const cals = [...new Set(exs.flatMap((e) => (e.period && 'calendar' in e.period ? [`${row.device}:6,${e.period.calendar[1]}`] : [])))]
          .map((k) => rowsByKey.get(k)).filter((r): r is ObjectRow => !!r)
        fields['date-list'] = []
        for (const cal of cals) {
          const [f] = await api.fieldPrepare([cal], 'date-list')
          if (f && !f.error) fields['date-list'].push({ field: f, calendar: cal })
        }
        if (!alive) return
        setLive(fields)
        setWeek(structuredClone((fields['weekly-schedule']?.[0].field.current as TimeValue[][]) ?? Array.from({ length: 7 }, () => [])))
        setExceptions(structuredClone(exs))
        setFallback(structuredClone((fields['schedule-default']?.[0].field.current as SValue) ?? null))
        setDates(Object.fromEntries(fields['date-list'].map((l) => [l.calendar!.key, structuredClone(l.field.current as CalendarEntry[])])))
        if (!fields['weekly-schedule']) setError('The weekly schedule could not be read live, so it cannot be edited.')
      } catch (e) {
        if (alive) setError(message(e))
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [row, rowsByKey])

  const type = valueType(week, fallback, ctx)
  const blank = (): SValue => (ctx.kind === 'binary' ? { type, value: 1 } : ctx.kind === 'multistate' ? { type, value: 1 } : { type, value: '' })

  const changes = useMemo<Change[] | string>(() => {
    const out: Change[] = []
    const w = live['weekly-schedule']?.[0]
    if (w) {
      const cleaned = week.map(clean)
      const bad = cleaned.findIndex((d) => d === null)
      if (bad >= 0) return `${DAYS[bad]}: every entry needs a time and a value.`
      const before = w.field.current as TimeValue[][]
      const changed = DAYS.filter((_, i) => !same(cleaned[i], before[i]))
      if (changed.length) out.push({ label: 'Weekly schedule', detail: changed.join(', '), field: w.field, value: cleaned })
    }
    const x = live['exception-schedule']?.[0]
    if (x) {
      const cleaned = exceptions.map((e) => ({ ...e, times: clean(e.times) }))
      if (cleaned.some((e) => e.times === null)) return 'Every exception entry needs a time and a value.'
      if (cleaned.some((e) => !e.period || ('date' in e.period && e.period.date[0] === null && e.period.date[1] === null && e.period.date[2] === null))) return 'Every exception needs a date.'
      const before = x.field.current as SpecialEvent[]
      if (!same(cleaned, before)) {
        const added = cleaned.length - before.length
        out.push({ label: 'Exceptions', detail: added > 0 ? `${added} added` : added < 0 ? `${-added} removed` : 'changed', field: x.field, value: cleaned })
      }
    }
    const f = live['schedule-default']?.[0]
    if (f && fallback) {
      const [c] = clean([{ time: '00:00', value: fallback }]) ?? []
      if (!c) return 'The default needs a value.'
      if (!same(c.value, f.field.current)) out.push({ label: 'Default value', detail: `${valueLabel(f.field.current as SValue, ctx)} → ${valueLabel(c.value, ctx)}`, field: f.field, value: c.value })
    }
    for (const l of live['date-list'] ?? []) {
      const d = dates[l.calendar!.key] ?? []
      if (d.some((e) => 'date' in e && e.date[0] === null && e.date[1] === null && e.date[2] === null)) return 'Every calendar date needs a day.'
      if (!same(d, l.field.current)) out.push({ label: `Calendar · ${l.field.name}`, detail: `${d.length} date${d.length === 1 ? '' : 's'}`, field: l.field, value: d })
    }
    return out
  }, [week, exceptions, fallback, dates, live, ctx])

  async function send() {
    if (!review) return
    setBusy(true)
    const out: NonNullable<typeof results> = []
    for (const c of review) {
      try {
        out.push(await api.fieldWrite(c.field.token, c.value))
      } catch (e) {
        out.push({ state: 'error', message: message(e), property: c.field.property })
      }
    }
    setResults(out)
    setBusy(false)
    control.refresh()
    onSaved((live['date-list'] ?? []).map((l) => [6, l.calendar!.instance]))
  }

  if (loading) return <div className="px-[18px] py-6 text-[13px] text-(--text-muted)">Reading the schedule live from the controller…</div>

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea scrollFade className="min-h-0 flex-1">
        <div className="flex flex-col gap-4 px-[18px] pb-4">
          {error ? <p role="alert" className="m-0 rounded-[12px] bg-(--status-alarm-bg) px-3 py-2 text-[12.5px]">{error}</p> : null}

          {/* the week */}
          {live['weekly-schedule'] ? (
            <section>
              <div className="mb-1.5 flex items-baseline justify-between text-[12px] text-(--text-muted)">
                <span>Week</span>
                <span className="text-[11px] text-(--text-faint)">Release ends a value; before the first entry the default applies</span>
              </div>
              <div className="flex flex-col divide-y divide-(--border-divider) rounded-[14px] border border-(--border-subtle)">
                {DAYS.map((name, d) => (
                  <div key={name} className="flex flex-col gap-2 px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span className="w-[86px] shrink-0 text-[12.5px] font-medium">{name}</span>
                      <DayBar entries={week[d] ?? []} fallback={fallback} color={color} ctx={ctx} />
                      <span className="flex shrink-0 gap-0.5">
                        {d < 5 && d === 0 ? (
                          <Button size="xs" variant="ghost" title="Copy Monday to Tuesday–Friday" onClick={() => setWeek((w) => w.map((day, i) => (i >= 1 && i <= 4 ? structuredClone(w[0]) : day)))}>
                            <Copy className="size-3.5" /> Weekdays
                          </Button>
                        ) : null}
                        <Button aria-label={`Add a time on ${name}`} size="icon-xs" variant="ghost" onClick={() => setWeek((w) => w.map((day, i) => (i === d ? [...day, { time: day.length ? hhmm(Math.min((minutesOf(day[day.length - 1].time) ?? 0) + 60, DAY_MIN - 1)) : '08:00', value: blank() }] : day)))}>
                          <Plus />
                        </Button>
                      </span>
                    </div>
                    {(week[d] ?? []).length ? (
                      <div className="flex flex-wrap gap-1.5 pl-[98px]">
                        {week[d].map((e, k) => (
                          <EntryEditor key={k} entry={e} ctx={ctx} type={type} color={color} label={`${name} entry ${k + 1}`}
                            onChange={(next) => setWeek((w) => w.map((day, i) => (i === d ? day.map((x, j) => (j === k ? next : x)) : day)))}
                            onRemove={() => setWeek((w) => w.map((day, i) => (i === d ? day.filter((_, j) => j !== k) : day)))} />
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* the default */}
          {live['schedule-default'] && fallback ? (
            <section className="flex items-center gap-3 rounded-[14px] border border-(--border-subtle) px-3 py-2.5">
              <span className="w-[86px] shrink-0 text-[12.5px] font-medium">Default</span>
              <span className="flex-1 text-[12px] text-(--text-muted)">Any time no entry or exception applies</span>
              <ValueEditor value={fallback} ctx={ctx} type={type} allowRelease={false} label="Default value" onChange={setFallback} />
            </section>
          ) : null}

          {/* exceptions */}
          {live['exception-schedule'] ? (
            <section>
              <div className="mb-1.5 flex items-center justify-between text-[12px] text-(--text-muted)">
                <span>Exceptions · priority 1 wins over 16</span>
                <Button size="xs" variant="ghost" onClick={() => {
                  const t = new Date(Date.now() + 86400000)
                  setExceptions((x) => [...x, { period: { date: [t.getFullYear(), t.getMonth() + 1, t.getDate(), null] }, times: [{ time: '00:00', value: blank() }], priority: 10 }])
                }}>
                  <Plus className="size-3.5" /> Add a date
                </Button>
              </div>
              <div className="flex flex-col gap-2">
                {exceptions.map((ex, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-[14px] border border-dashed border-(--border-default) px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <PeriodEditor ex={ex} calendars={calendars} device={row.device} onChange={(period) => setExceptions((x) => x.map((e, j) => (j === i ? { ...e, period } : e)))} />
                      <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-(--text-muted)">
                        P
                        <input aria-label={`Exception ${i + 1} priority`} type="number" min={1} max={16} className="h-7 w-12 rounded-[8px] border border-(--border-default) bg-(--surface-input) px-1.5 text-[12.5px] tabular-nums"
                          value={ex.priority} onChange={(e) => setExceptions((x) => x.map((y, j) => (j === i ? { ...y, priority: Math.min(16, Math.max(1, Number(e.target.value) || 16)) } : y)))} />
                      </label>
                      <Button aria-label={`Add a time to exception ${i + 1}`} size="icon-xs" variant="ghost" onClick={() => setExceptions((x) => x.map((y, j) => (j === i ? { ...y, times: [...y.times, { time: '12:00', value: blank() }] } : y)))}><Plus /></Button>
                      <Button aria-label={`Remove exception ${i + 1}`} size="icon-xs" variant="ghost" onClick={() => setExceptions((x) => x.filter((_, j) => j !== i))}><XIcon /></Button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {ex.times.map((e, k) => (
                        <EntryEditor key={k} entry={e} ctx={ctx} type={type} color={color} label={`Exception ${i + 1} entry ${k + 1}`}
                          onChange={(next) => setExceptions((x) => x.map((y, j) => (j === i ? { ...y, times: y.times.map((z, m) => (m === k ? next : z)) } : y)))}
                          onRemove={() => setExceptions((x) => x.map((y, j) => (j === i ? { ...y, times: y.times.filter((_, m) => m !== k) } : y)))} />
                      ))}
                      {!ex.times.length ? <span className="text-[11.5px] text-(--text-muted)">No times: the week runs as normal that day.</span> : null}
                    </div>
                  </div>
                ))}
                {!exceptions.length ? <p className="m-0 text-[12px] text-(--text-muted)">None. The week runs every week.</p> : null}
              </div>
            </section>
          ) : null}

          {/* calendars the exceptions use */}
          {(live['date-list'] ?? []).map((l) => {
            const list = dates[l.calendar!.key] ?? []
            const set = (next: CalendarEntry[]) => setDates((d) => ({ ...d, [l.calendar!.key]: next }))
            return (
              <section key={l.calendar!.key}>
                <div className="mb-1.5 flex items-center justify-between text-[12px] text-(--text-muted)">
                  <span>Calendar · {l.field.name} <span className="text-(--text-faint)">used by the exceptions; changing it changes every schedule using it</span></span>
                  <Button size="xs" variant="ghost" onClick={() => { const t = new Date(); set([...list, { date: [t.getFullYear(), t.getMonth() + 1, t.getDate(), null] }]) }}><Plus className="size-3.5" /> Add a date</Button>
                </div>
                <div className="flex flex-col divide-y divide-(--border-divider) rounded-[14px] border border-(--border-subtle)">
                  {list.map((e, i) => (
                    <div key={i} className="flex min-h-10 items-center gap-2 px-3 text-[12.5px]">
                      <CalendarEntryEditor entry={e} onChange={(next) => set(list.map((x, j) => (j === i ? next : x)))} />
                      <Button aria-label={`Remove calendar date ${i + 1}`} size="icon-xs" variant="ghost" onClick={() => set(list.filter((_, j) => j !== i))}><XIcon /></Button>
                    </div>
                  ))}
                  {!list.length ? <div className="px-3 py-2.5 text-[12px] text-(--text-muted)">No dates.</div> : null}
                </div>
              </section>
            )
          })}
        </div>
      </ScrollArea>

      {/* review, send, results */}
      <div className="border-t border-(--border-subtle) px-[18px] py-3">
        {results ? (
          <div className="flex flex-col gap-2">
            {results.map((r, i) => (
              <p key={i} role="status" className={cn('m-0 rounded-[10px] px-3 py-2 text-[12.5px]', r.state === 'verified' ? 'bg-(--status-ok-bg)' : r.state === 'rejected' || r.state === 'error' ? 'bg-(--status-alarm-bg)' : 'bg-(--status-warn-bg)')}>
                <b className="font-medium">{review?.[i]?.label}</b> · {r.message}
              </p>
            ))}
            <div className="flex justify-end"><Button size="sm" onClick={onClose}>Done</Button></div>
          </div>
        ) : review ? (
          <div className="flex flex-col gap-2">
            <div className="rounded-[12px] bg-(--surface-checked) px-3 py-2.5 text-[12.5px]">
              <div className="mb-1 font-medium">Write to {row.values['object-name']}</div>
              {review.map((c) => <div key={c.label} className="flex justify-between gap-3"><span>{c.label}</span><span className="text-(--text-muted)">{c.detail}</span></div>)}
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReview(null)}>Back</Button>
              <Button size="sm" loading={busy} onClick={() => void send()}>Send {review.length} change{review.length === 1 ? '' : 's'}</Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="text-[12px] text-(--text-muted)">{typeof changes === 'string' ? <span className="text-(--status-alarm-strong)">{changes}</span> : changes.length ? `${changes.length} propert${changes.length === 1 ? 'y' : 'ies'} changed` : 'No changes yet'}</span>
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button size="sm" disabled={typeof changes === 'string' || !changes.length} onClick={() => typeof changes !== 'string' && setReview(changes)}>Review</Button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** A day as it will run from the draft: the default until the first entry, each value until the next. */
function DayBar({ entries, fallback, color, ctx }: { entries: TimeValue[]; fallback: SValue | null; color: (v: SValue | null) => string; ctx: ValueContext }) {
  const sorted = entries.filter((e) => e.time).map((e) => ({ m: minutesOf(e.time)!, v: e.value })).sort((a, b) => a.m - b.m)
  const segs: { start: number; end: number; v: SValue | null }[] = []
  let at = 0, cur: SValue | null = null
  for (const e of sorted) {
    if (e.m > at) segs.push({ start: at, end: e.m, v: cur })
    at = e.m
    cur = e.v.type === 'null' ? null : e.v
  }
  segs.push({ start: at, end: DAY_MIN, v: cur })
  return (
    <div className="relative flex h-5 min-w-0 flex-1 overflow-hidden rounded-[6px] bg-(--surface-card-muted)">
      {segs.filter((s) => s.end > s.start).map((s, i) => (
        <div key={i} className="h-full border-r border-white/60 last:border-r-0" style={{ width: `${((s.end - s.start) / DAY_MIN) * 100}%`, background: s.v ? fillOf(color(s.v)) : 'transparent' }}
          title={`${hhmm(s.start)}–${hhmm(s.end % DAY_MIN)} · ${s.v ? valueLabel(s.v, ctx) : `default (${valueLabel(fallback, ctx)})`}`} />
      ))}
    </div>
  )
}

function EntryEditor({ entry, ctx, type, color, label, onChange, onRemove }: { entry: TimeValue; ctx: ValueContext; type: SValue['type']; color: (v: SValue | null) => string; label: string; onChange: (e: TimeValue) => void; onRemove: () => void }) {
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border border-(--border-subtle) bg-(--surface-card) pr-1 pl-2">
      <span className="size-2 shrink-0 rounded-full" style={{ background: entry.value.type === 'null' ? 'transparent' : fillOf(color(entry.value)), boxShadow: 'inset 0 0 0 1px rgba(41,41,41,0.15)' }} />
      <input aria-label={`${label} time`} type="time" className="w-[74px] bg-transparent text-[12.5px] tabular-nums outline-none" value={entry.time?.slice(0, 5) ?? ''} onChange={(e) => onChange({ ...entry, time: e.target.value })} />
      <ValueEditor value={entry.value} ctx={ctx} type={type} allowRelease label={`${label} value`} compact onChange={(value) => onChange({ ...entry, value })} />
      <button aria-label={`Remove ${label}`} onClick={onRemove} className="inline-flex size-6 items-center justify-center rounded-full text-(--text-faint) hover:bg-(--surface-track) hover:text-(--text-strong)"><XIcon className="size-3" /></button>
    </span>
  )
}

/** A schedule value in the driven point's own terms: its states, its two texts, or a number in its units. */
function ValueEditor({ value, ctx, type, allowRelease, label, compact, onChange }: { value: SValue; ctx: ValueContext; type: SValue['type']; allowRelease: boolean; label: string; compact?: boolean; onChange: (v: SValue) => void }) {
  const options =
    ctx.kind === 'binary' ? [{ v: '1', label: ctx.active }, { v: '0', label: ctx.inactive }]
    : ctx.kind === 'multistate' ? (ctx.states.length ? ctx.states : ['State 1', 'State 2', 'State 3']).map((s, i) => ({ v: String(i + 1), label: s }))
    : null
  const items = [...(options ?? []).map((o) => ({ value: o.v, label: o.label })), ...(options || !allowRelease ? [] : [{ value: 'number', label: 'Value' }]), ...(allowRelease ? [{ value: 'null', label: 'Release' }] : [])]
  const current = value.type === 'null' ? 'null' : options ? String(value.value) : 'number'
  return (
    <span className="inline-flex items-center gap-1">
      {options || allowRelease ? (
        <Select value={current} items={items} onValueChange={(v) => onChange(v === 'null' ? { type: 'null', value: null } : v === 'number' ? { type, value: '' } : { type, value: Number(v) })}>
          <SelectTrigger aria-label={label} className={cn('h-7 w-auto rounded-full border-0 bg-(--surface-track) px-2.5 text-[12px]', compact ? 'min-w-[86px]' : 'min-w-[140px]')}><SelectValue /></SelectTrigger>
          <SelectPopup>{items.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectPopup>
        </Select>
      ) : null}
      {!options && value.type !== 'null' ? (
        <Input aria-label={label} type="number" step="any" size="sm" className="h-7 w-[76px] tabular-nums" value={String(value.value ?? '')} onChange={(e) => onChange({ type, value: e.target.value })} />
      ) : null}
    </span>
  )
}

const isoOf = (d: BDate) => (d[0] !== null && d[1] !== null && d[2] !== null && d[1] <= 12 && d[2] <= 31 ? `${d[0]}-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}` : '')
const dateOf = (iso: string, keep: BDate): BDate => (iso ? [...(iso.split('-').map(Number) as [number, number, number]), null] : keep)

/** An exception's date or range is edited here; a calendar reference or a repeating rule is kept as it is. */
function PeriodEditor({ ex, calendars, device, onChange }: { ex: SpecialEvent; calendars: Calendars; device: number; onChange: (p: SpecialEvent['period']) => void }) {
  const p = ex.period
  if (p && ('date' in p || 'range' in p) && (isoOf('date' in p ? p.date : p.range[0]) || ('date' in p && p.date.every((x) => x === null)))) return <span className="flex min-w-0 flex-1"><CalendarEntryEditor entry={p} onChange={onChange} /></span>
  return <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium" title="Kept as it is">{describePeriod(p, device, calendars)}</span>
}

function CalendarEntryEditor({ entry, onChange }: { entry: CalendarEntry; onChange: (e: CalendarEntry) => void }) {
  const box = 'h-7 rounded-[8px] border border-(--border-default) bg-(--surface-input) px-1.5 text-[12.5px] tabular-nums'
  if ('date' in entry && (isoOf(entry.date) || entry.date.every((x) => x === null))) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <input aria-label="Date" type="date" className={box} value={isoOf(entry.date)} onChange={(e) => onChange({ date: dateOf(e.target.value, entry.date) })} />
        <button className="text-[11.5px] text-(--text-muted) hover:text-(--text-strong)" onClick={() => onChange({ range: [entry.date, entry.date] })}>Make a range</button>
      </span>
    )
  }
  if ('range' in entry && isoOf(entry.range[0]) && isoOf(entry.range[1])) {
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <input aria-label="From" type="date" className={box} value={isoOf(entry.range[0])} onChange={(e) => onChange({ range: [dateOf(e.target.value, entry.range[0]), entry.range[1]] })} />
        <span className="text-(--text-faint)">to</span>
        <input aria-label="Until" type="date" className={box} value={isoOf(entry.range[1])} onChange={(e) => onChange({ range: [entry.range[0], dateOf(e.target.value, entry.range[1])] })} />
      </span>
    )
  }
  // every year, a weekday rule or an open range: shown in words and kept
  return <span className="min-w-0 flex-1 truncate" title="Kept as it is">{describeEntry(entry)}</span>
}
