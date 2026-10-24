import { useEffect, useMemo, useState } from 'react'
import type { Device, ObjectRow, Status } from '../api'
import {
  DAY_MIN,
  addDays,
  calendarsOf,
  colorScale,
  daySegments,
  describeEffective,
  describeEntry,
  describePeriod,
  exceptionName,
  fillOf,
  hhmm,
  matchPeriod,
  nowAndNext,
  readSchedule,
  sameDay,
  startOfWeek,
  valueContext,
  valueLabel,
  type Calendars,
  type Schedule,
  type Segment,
  type SValue,
  type ValueContext,
} from '../schedule'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'
import { Detail, EmptyState, Group, PaneSearch, PaneTitle } from './Inspector'
import { Pane, PaneToggle } from './Layout'
import { SPIN, useSpin } from './spin'

const { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, ReloadIcon } = Hugeicons

const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const HATCH = 'repeating-linear-gradient(135deg, rgba(41,41,41,0.05) 0 6px, transparent 6px 12px)'

const useNow = (ms: number) => {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

const fmtDay = (d: Date, opts: Intl.DateTimeFormatOptions) => d.toLocaleDateString(undefined, opts)
const when = (at: Date, now: Date) =>
  sameDay(at, now) ? hhmm(at.getHours() * 60 + at.getMinutes()) : `${fmtDay(at, { weekday: 'short' })} ${hhmm(at.getHours() * 60 + at.getMinutes())}`

type Prepared = { s: Schedule; ctx: ValueContext; color: (v: SValue | null) => string; name: string }

/** Where a segment's value comes from, in words. */
function sourceText(seg: Segment, p: Prepared, calendars: Calendars) {
  if (seg.source === 'off') return 'Not in effect'
  if (seg.source === 'default') return 'Default value'
  if (seg.source === 'weekly') return 'Weekly schedule'
  const ex = p.s.exceptions[seg.source]
  return `Exception · ${describePeriod(ex.period, p.s.row.device, calendars)}`
}

/** The next date (from today, up to a year out) an exception applies. */
function nextDate(p: Prepared, i: number, calendars: Calendars, from: Date) {
  const ex = p.s.exceptions[i]
  for (let k = 0; k < 400; k++) {
    const d = addDays(from, k)
    if (matchPeriod(d, ex.period, p.s.row.device, calendars)) return d
  }
  return null
}

export function SchedulesView({
  status,
  rows,
  devices,
  onShowInObjects,
  onReread,
  onGoToObjects,
}: {
  status: Status
  rows: ObjectRow[]
  devices: Device[]
  onShowInObjects: (row: ObjectRow) => void
  onReread: (row: ObjectRow, also: [number, number][]) => Promise<void>
  onGoToObjects: () => void
}) {
  const now = useNow(30_000)
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(() => localStorage.getItem('bx.schedule'))
  const [view, setView] = useState<'week' | 'month'>('week')
  const [anchor, setAnchor] = useState(() => new Date())
  const [rereading, spinReread] = useSpin()

  const rowsByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const calendars = useMemo(() => calendarsOf(rows), [rows])
  const schedules = useMemo(() => rows.filter((r) => r.typeId === 17), [rows])

  const prepared = useMemo(() => {
    const m = new Map<string, Prepared>()
    for (const r of schedules) {
      const s = readSchedule(r)
      const ctx = valueContext(s, rowsByKey)
      const values = [...(s.weekly ?? []).flat().map((t) => t.value), ...s.exceptions.flatMap((e) => e.times.map((t) => t.value)), s.fallback]
      m.set(r.key, { s, ctx, color: colorScale(values, ctx), name: r.values['object-name'] || `Schedule ${r.instance}` })
    }
    return m
  }, [schedules, rowsByKey])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return schedules.filter((r) => !q || [r.values['object-name'], r.values.description, r.values['Device name']].some((v) => (v ?? '').toLowerCase().includes(q)))
  }, [schedules, search])

  const byDevice = useMemo(() => {
    const groups = new Map<number, ObjectRow[]>()
    for (const r of filtered) groups.set(r.device, [...(groups.get(r.device) ?? []), r])
    return [...groups].map(([inst, list]) => ({ device: devices.find((d) => d.instance === inst), inst, list }))
  }, [filtered, devices])

  const selected = (selectedKey && prepared.get(selectedKey)) || (schedules[0] ? prepared.get(schedules[0].key) : undefined)
  useEffect(() => {
    if (selected) localStorage.setItem('bx.schedule', selected.s.row.key)
  }, [selected])

  const pick = (key: string) => {
    setSelectedKey(key)
    setAnchor(new Date())
  }

  // ---- empty: nothing read has a schedule ----
  if (!schedules.length) {
    return (
      <>
        <Pane side="left">
          <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
            <PaneTitle title="Schedules" />
            <div className="mx-3 mt-1 rounded-[12px] border border-dashed border-(--border-default) px-3.5 py-3 text-[12.5px] leading-snug text-(--text-muted)">
              Schedule objects show up here once their device is read.
            </div>
          </aside>
        </Pane>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-3 pl-2 text-[13px] text-(--text-muted)">
            <PaneToggle side="left" />
            <span>Schedules</span>
          </header>
          <div className="flex min-h-0 flex-1 px-3 pb-3">
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
              <EmptyState
                icon={<CalendarClock className="size-5" />}
                title="No schedules yet"
                text={
                  devices.length
                    ? 'None of the devices read so far has a Schedule object. Read more devices in Objects; their schedules appear here.'
                    : status.connected
                      ? 'Read a device in Objects. Its Schedule objects appear here, with the week laid out as the controller runs it.'
                      : 'Connect and read a device, or open a saved site. Schedules appear here, with the week laid out as the controller runs it.'
                }
                action={
                  <Button size="sm" onClick={onGoToObjects}>
                    Go to Objects
                  </Button>
                }
              />
            </section>
          </div>
        </main>
      </>
    )
  }

  const p = selected!
  const row = p.s.row
  const device = devices.find((d) => d.instance === row.device)
  const { current, next } = nowAndNext(p.s, calendars, now)
  const weekStart = startOfWeek(anchor)
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const monthDays = Array.from({ length: 42 }, (_, i) => addDays(startOfWeek(monthStart), i))
  const visible = view === 'week' ? days : monthDays.filter((d) => d.getMonth() === anchor.getMonth())
  const segsByDay = new Map(visible.map((d) => [d.toDateString(), daySegments(p.s, d, calendars)]))
  const legend = (() => {
    const seen = new Map<string, { label: string; color: string }>()
    for (const segs of segsByDay.values())
      for (const seg of segs) {
        if (seg.source === 'default' || seg.source === 'off' || !seg.value) continue
        const label = valueLabel(seg.value, p.ctx)
        if (!seen.has(label)) seen.set(label, { label, color: p.color(seg.value) })
      }
    return [...seen.values()]
  })()
  const usesExceptions = [...segsByDay.values()].some((segs) => segs.some((s) => typeof s.source === 'number'))
  const rangeLabel =
    view === 'week'
      ? `${fmtDay(days[0], { day: 'numeric', month: 'short' })} – ${fmtDay(days[6], { day: 'numeric', month: 'short', year: 'numeric' })}`
      : fmtDay(anchor, { month: 'long', year: 'numeric' })
  const step = (dir: number) => setAnchor((a) => (view === 'week' ? addDays(a, dir * 7) : new Date(a.getFullYear(), a.getMonth() + dir, 1)))
  const isThisPeriod = view === 'week' ? sameDay(weekStart, startOfWeek(now)) : anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear()
  const refs = p.s.refs.map((r) => ({ ref: r, row: rowsByKey.get(`${r.device ?? row.device}:${r.object[0]},${r.object[1]}`) }))
  const reliability = row.values.reliability
  const faulty = reliability && reliability !== 'no-fault-detected'
  const outOfService = row.values['out-of-service'] === 'true'
  const calendarRefs = p.s.exceptions.flatMap((e) => (e.period && 'calendar' in e.period ? [e.period.calendar] : []))

  return (
    <>
      <Pane side="left">
        <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
          <PaneTitle title="Schedules" count={schedules.length} />
          {schedules.length > 6 ? <PaneSearch value={search} onChange={setSearch} placeholder="Search schedules" /> : null}
          <ScrollArea scrollFade className="min-h-0 flex-1">
            <div className="flex flex-col px-2 pb-3">
              {byDevice.map((g) => (
                <div key={g.inst} className="flex flex-col gap-px">
                  {devices.length > 1 || byDevice.length > 1 ? (
                    <div className="truncate px-2 pt-2.5 pb-1 text-[11px] text-(--text-faint)">{g.device?.name || `Device ${g.inst}`}</div>
                  ) : null}
                  {g.list.map((r) => {
                    const item = prepared.get(r.key)!
                    const nn = nowAndNext(item.s, calendars, now)
                    const off = nn.current.source === 'off'
                    const cur = nn.current.value
                    return (
                      <button
                        key={r.key}
                        onClick={() => pick(r.key)}
                        data-active={selected?.s.row.key === r.key ? 'true' : undefined}
                        className="flex h-[52px] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] data-[active=true]:bg-(--paper-3)"
                      >
                        <span
                          className="size-2.5 shrink-0 rounded-[3px] border border-[rgba(41,41,41,0.08)]"
                          style={{ background: off || nn.current.source === 'default' ? 'transparent' : fillOf(item.color(cur)), backgroundImage: off ? HATCH : undefined }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px] font-medium">{item.name}</span>
                          <span className="mt-0.5 block truncate text-[11.5px] text-(--text-muted)">
                            {off ? 'Not in effect' : valueLabel(cur, item.ctx)}
                            {nn.next ? ` · until ${when(nn.next.at, now)}` : ''}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ))}
              {!filtered.length ? <div className="px-2 py-6 text-center text-[12.5px] text-(--text-muted)">No schedules match.</div> : null}
            </div>
          </ScrollArea>
        </aside>
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2 text-[13px] text-(--text-muted)">
          <PaneToggle side="left" />
          <span>Schedules</span>
          <ArrowRight className="size-3 text-(--ink-4)" />
          <span className="truncate font-medium text-(--text-strong)">{p.name}</span>
          <span className="flex-1" />
          <PaneToggle side="right" />
        </header>
        <div className="flex min-h-0 flex-1 gap-[10px] px-3 pb-3">
          <section key={row.key} className="nc-view-in flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
            <div className="flex items-start gap-3 px-[18px] pt-[18px] pb-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 truncate text-[20px] font-medium tracking-[-0.02em]">{p.name}</h1>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-(--text-muted)">
                  <span className="inline-flex shrink-0 items-center gap-1.5">
                    <span className={cn('size-1.5 rounded-full', faulty ? 'bg-(--status-alarm-strong)' : outOfService || current.source === 'off' ? 'bg-(--ink-4)' : 'bg-(--status-ok-strong)')} />
                    {faulty ? reliability : outOfService ? 'Out of service' : current.source === 'off' ? 'Not in effect today' : 'Running'}
                  </span>
                  <span aria-hidden>·</span>
                  <span className="truncate">
                    {device?.name || `Device ${row.device}`} · schedule {row.instance}
                    {refs.length ? ` · drives ${refs.length === 1 ? refs[0].row?.values['object-name'] || 'one point' : `${refs.length} points`}` : ''}
                  </span>
                </div>
              </div>
              <Button
                size="sm"
                variant="white"
                disabled={!status.connected || rereading}
                title={status.connected ? 'Read this schedule from the controller again' : 'Connect to read it again'}
                onClick={() => spinReread(() => onReread(row, calendarRefs))}
              >
                <ReloadIcon className={rereading ? SPIN : ''} />
                Read again
              </Button>
            </div>

            {!p.s.weekly ? (
              !row.detail ? (
                <EmptyState
                  icon={<CalendarClock className="size-5" />}
                  title="Read this schedule again to see its week"
                  text="It was read by an earlier version of BACon, which kept only the text of each property. Reading it again lays out the week and its exceptions."
                  action={
                    <Button size="sm" disabled={!status.connected || rereading} onClick={() => spinReread(() => onReread(row, calendarRefs))}>
                      <ReloadIcon className={rereading ? SPIN : ''} />
                      {status.connected ? 'Read again' : 'Connect to read again'}
                    </Button>
                  }
                />
              ) : (
              <EmptyState
                title="This schedule could not be decoded"
                text={
                  <>
                    The controller sent a weekly schedule BACon cannot lay out. The raw value is below, and in Objects.
                    <span className="mt-3 block rounded-[12px] bg-(--surface-card-muted) px-3 py-2 text-left font-mono text-[11px] break-words">
                      {row.values['weekly-schedule'] || row.errors['weekly-schedule'] || 'No weekly-schedule property.'}
                    </span>
                  </>
                }
                action={
                  <Button size="sm" variant="secondary" onClick={() => onShowInObjects(row)}>
                    Show in Objects
                  </Button>
                }
              />
              )
            ) : (
              <>
                <div className="flex items-center gap-3 px-[18px] pb-2.5">
                  <div className="flex items-center gap-1">
                    <Button aria-label={view === 'week' ? 'Previous week' : 'Previous month'} variant="white" size="icon-xs" onClick={() => step(-1)}>
                      <ChevronLeft />
                    </Button>
                    <Button aria-label={view === 'week' ? 'Next week' : 'Next month'} variant="white" size="icon-xs" onClick={() => step(1)}>
                      <ChevronRight />
                    </Button>
                    <Button variant="white" size="xs" className="px-3" disabled={isThisPeriod} onClick={() => setAnchor(new Date())}>
                      Today
                    </Button>
                  </div>
                  <span className="truncate text-[13px] font-medium tabular-nums">{rangeLabel}</span>
                  <span className="flex-1" />
                  <div role="group" aria-label="Calendar view" className="inline-flex shrink-0 gap-0.5 rounded-full bg-(--surface-track) p-[3px]">
                    {(['week', 'month'] as const).map((m) => (
                      <button
                        key={m}
                        aria-pressed={view === m}
                        onClick={() => setView(m)}
                        className={cn('h-6 rounded-full px-3 text-[12px] capitalize transition-colors', view === m ? 'bg-(--ink) text-white' : 'text-(--text-muted) hover:text-(--text-strong)')}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex min-h-[30px] flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-(--border-subtle) px-[18px] pb-2.5 text-[12px] text-(--text-muted)">
                  {legend.map((l) => (
                    <span key={l.label} className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-[3px]" style={{ background: fillOf(l.color), boxShadow: 'inset 0 0 0 1px rgba(41,41,41,0.08)' }} />
                      {l.label}
                    </span>
                  ))}
                  {usesExceptions ? (
                    <span className="flex items-center gap-1.5">
                      <span className="size-2.5 rounded-[3px] border-[1.5px] border-dashed border-(--ink-3)" />
                      Exception
                    </span>
                  ) : null}
                  <span className="text-(--text-faint)">{legend.length ? 'Any other time' : 'No times this period. All the time'}: {valueLabel(p.s.fallback, p.ctx)}</span>
                </div>
                {view === 'week' ? (
                  <WeekGrid p={p} days={days} segsByDay={segsByDay} calendars={calendars} now={now} />
                ) : (
                  <MonthGrid
                    p={p}
                    days={monthDays}
                    month={anchor.getMonth()}
                    calendars={calendars}
                    now={now}
                    onDay={(d) => {
                      setAnchor(d)
                      setView('week')
                    }}
                  />
                )}
              </>
            )}
          </section>

          <Pane side="right" gap={10}>
            <ScrollArea scrollFade className="min-h-0 w-full">
              <aside key={row.key} className="nc-view-in flex w-full min-w-0 flex-col gap-2.5 pb-1">
                <NowCard p={p} current={current} next={next} now={now} calendars={calendars} />
                <Group label="Behaviour">
                  <dl className="m-0">
                    <Detail label="Default value">{valueLabel(p.s.fallback, p.ctx)}</Detail>
                    <Detail label="Writes at priority">{row.values['priority-for-writing'] ? `P${row.values['priority-for-writing']}` : '–'}</Detail>
                    <Detail label="In effect">{describeEffective(p.s)}</Detail>
                    <Detail label="Status">{faulty ? <span className="text-(--status-alarm-strong)">{reliability}</span> : outOfService ? 'Out of service' : 'Normal'}</Detail>
                  </dl>
                </Group>
                <Group label={refs.length === 1 ? 'Drives' : `Drives ${refs.length || ''}`}>
                  {refs.length ? (
                    <div className="-mx-2 flex flex-col">
                      {refs.map(({ ref, row: target }, i) => (
                        <button
                          key={i}
                          disabled={!target}
                          onClick={() => target && onShowInObjects(target)}
                          className="flex min-h-10 items-center gap-2 rounded-[10px] px-2 text-left text-[12.5px] transition-colors hover:bg-(--surface-hover) disabled:hover:bg-transparent"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{target?.values['object-name'] || `${ref.object[0]},${ref.object[1]}`}</span>
                            <span className="block truncate text-[11.5px] text-(--text-muted)">
                              {target?.values['Object type'] ?? 'not read'} {ref.object[1]} · {ref.property}
                              {ref.device !== null && ref.device !== row.device ? ` · device ${ref.device}` : ''}
                            </span>
                          </span>
                          {target?.values['present-value'] !== undefined ? (
                            <span className="shrink-0 tabular-nums text-(--text-muted)">{target.values['present-value']}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="m-0 text-[12.5px] text-(--text-muted)">No points listed. The schedule only keeps its own present value.</p>
                  )}
                </Group>
                <Group label={`Exceptions${p.s.exceptions.length ? ` ${p.s.exceptions.length}` : ''}`}>
                  {p.s.exceptions.length ? (
                    <div className="flex flex-col gap-2">
                      {p.s.exceptions
                        .map((ex, i) => ({ ex, i, next: nextDate(p, i, calendars, now) }))
                        .sort((a, b) => (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity))
                        .map(({ ex, i, next: on }) => {
                          const cal = ex.period && 'calendar' in ex.period ? calendars.get(`${row.device}:${ex.period.calendar[1]}`) : undefined
                          return (
                            <div key={i} className="rounded-[12px] border border-dashed border-(--border-default) px-3 py-2.5">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-[12.5px] font-medium">{describePeriod(ex.period, row.device, calendars)}</div>
                                  <div className="mt-0.5 text-[11.5px] text-(--text-muted)">
                                    {on ? (sameDay(on, now) ? 'Today' : `Next ${fmtDay(on, { weekday: 'short', day: 'numeric', month: 'short' })}`) : 'No date in the coming year'}
                                    {cal ? ` · calendar, ${cal.entries.length} ${cal.entries.length === 1 ? 'entry' : 'entries'}` : ''}
                                  </div>
                                </div>
                                <span className="shrink-0 rounded-full bg-(--surface-track) px-2 text-[11px] leading-5 tabular-nums text-(--text-muted)" title="Exception priority: 1 wins over 16">
                                  P{ex.priority}
                                </span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {ex.times.length ? (
                                  ex.times.map((t, k) => (
                                    <span key={k} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-(--surface-card-muted) pr-2.5 pl-1.5 text-[11.5px] tabular-nums">
                                      <span className="size-2 rounded-full" style={{ background: t.value.type === 'null' ? 'transparent' : fillOf(p.color(t.value)), boxShadow: 'inset 0 0 0 1px rgba(41,41,41,0.12)' }} />
                                      {t.time?.slice(0, 5) ?? '--:--'} {valueLabel(t.value, p.ctx)}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-[11.5px] text-(--text-muted)">No times: the weekly schedule runs as normal.</span>
                                )}
                              </div>
                              {cal && cal.entries.length ? (
                                <ul className="m-0 mt-2 flex list-none flex-col gap-0.5 border-t border-(--border-divider) p-0 pt-2 text-[11.5px] text-(--text-muted)">
                                  {cal.entries.slice(0, 8).map((e, k) => (
                                    <li key={k} className="truncate">
                                      {describeEntry(e)}
                                    </li>
                                  ))}
                                  {cal.entries.length > 8 ? <li>and {cal.entries.length - 8} more</li> : null}
                                </ul>
                              ) : null}
                            </div>
                          )
                        })}
                    </div>
                  ) : (
                    <p className="m-0 text-[12.5px] text-(--text-muted)">None. The weekly schedule runs every week.</p>
                  )}
                </Group>
                <Button size="sm" variant="secondary" onClick={() => onShowInObjects(row)}>
                  Show in Objects
                </Button>
              </aside>
            </ScrollArea>
          </Pane>
        </div>
      </main>
    </>
  )
}

/** The value now, in the dark card the Trends page uses for a point's live value. */
function NowCard({ p, current, next, now, calendars }: { p: Prepared; current: Segment; next: { at: Date; segment: Segment } | null; now: Date; calendars: Calendars }) {
  const off = current.source === 'off'
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#292929] p-4 text-white">
      <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-[radial-gradient(circle,rgba(198,245,111,.22),transparent_65%)]" />
      <div className="relative text-[11.5px] text-white/60">Now · {hhmm(now.getHours() * 60 + now.getMinutes())}</div>
      <div className="relative mt-2 flex items-center gap-2.5">
        {!off && current.value && current.value.type !== 'null' ? <span className="size-3 shrink-0 rounded-[4px]" style={{ background: p.color(current.value) }} /> : null}
        <span className="truncate text-[28px] leading-none font-medium tracking-[-0.02em]">{off ? 'Not in effect' : valueLabel(current.value, p.ctx)}</span>
      </div>
      <div className="relative mt-2.5 text-[12px] text-white/70">{sourceText(current, p, calendars)}</div>
      <div className="relative mt-3 flex items-center gap-2 border-t border-white/10 pt-3 text-[12px]">
        {next ? (
          <>
            <span className="text-white/60">{sameDay(next.at, now) ? 'At' : fmtDay(next.at, { weekday: 'short', day: 'numeric', month: 'short' })}</span>
            <span className="font-medium tabular-nums">{hhmm(next.at.getHours() * 60 + next.at.getMinutes())}</span>
            <ArrowRight className="size-3 text-white/40" />
            <span className="truncate">{next.segment.source === 'off' ? 'Not in effect' : valueLabel(next.segment.value, p.ctx)}</span>
          </>
        ) : (
          <span className="text-white/60">No change in the coming week</span>
        )}
      </div>
    </div>
  )
}

const HOURS = Array.from({ length: 13 }, (_, i) => i * 2)

function WeekGrid({ p, days, segsByDay, calendars, now }: { p: Prepared; days: Date[]; segsByDay: Map<string, Segment[]>; calendars: Calendars; now: Date }) {
  const minute = now.getHours() * 60 + now.getMinutes()
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-3 pb-4 [scrollbar-width:thin]">
      <div className="flex min-w-[640px] gap-1.5 pb-2">
        <div className="w-11 shrink-0" />
        {days.map((d, i) => {
          const today = sameDay(d, now)
          return (
            <div key={i} className="flex h-7 min-w-0 flex-1 items-center gap-1.5 pl-1 text-[12px]">
              <span className={today ? 'text-(--text-strong)' : 'text-(--text-muted)'}>{DAY_SHORT[i]}</span>
              <span className={cn('tabular-nums', today ? 'font-medium text-(--text-strong)' : 'text-(--text-faint)')}>{d.getDate()}</span>
              {today ? <span className="size-1.5 rounded-full bg-(--status-ok-strong)" /> : null}
            </div>
          )
        })}
      </div>
      <div className="flex min-h-[460px] min-w-[640px] flex-1 gap-1.5">
        <div className="relative w-11 shrink-0">
          {HOURS.map((h) => (
            <div key={h} className="absolute left-0 -translate-y-1/2 font-mono text-[10px] text-(--text-faint) tabular-nums select-none" style={{ top: `${(h / 24) * 100}%` }}>
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map((d, i) => {
          const segs = segsByDay.get(d.toDateString()) ?? []
          const off = segs.length === 1 && segs[0].source === 'off'
          return (
            <div
              key={i}
              className="relative min-w-0 flex-1 rounded-[10px] border border-[rgba(41,41,41,0.06)] bg-[#fafafa]"
              style={off ? { backgroundImage: HATCH } : undefined}
            >
              {Array.from({ length: 23 }, (_, h) => (
                <div key={h} className="absolute inset-x-0 border-t border-[rgba(41,41,41,0.06)]" style={{ top: `${((h + 1) / 24) * 100}%` }} />
              ))}
              {off ? (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-1 text-center text-[11px] text-(--text-faint)">Not in effect</div>
              ) : (
                segs
                  .filter((s) => s.source !== 'default' && s.value && s.value.type !== 'null')
                  .map((s, k) => <Block key={k} p={p} seg={s} day={d} calendars={calendars} />)
              )}
              {sameDay(d, now) ? (
                <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: `${(minute / DAY_MIN) * 100}%` }}>
                  <div className="relative flex items-center">
                    <div className="-ml-[3px] size-1.5 shrink-0 rounded-full bg-(--status-alarm-strong)" />
                    <div className="h-px flex-1 bg-(--status-alarm-strong)" />
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Block({ p, seg, day, calendars }: { p: Prepared; seg: Segment; day: Date; calendars: Calendars }) {
  const color = p.color(seg.value)
  const exception = typeof seg.source === 'number'
  const minutes = seg.end - seg.start
  const label = valueLabel(seg.value, p.ctx)
  const range = `${hhmm(seg.start)} – ${seg.end === DAY_MIN ? '24:00' : hhmm(seg.end)}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            tabIndex={0}
            aria-label={`${fmtDay(day, { weekday: 'long' })} ${range}: ${label}`}
            className="@container absolute inset-x-1 flex flex-col overflow-hidden rounded-[8px] text-[#292929] outline-none transition-[transform,box-shadow] duration-150 hover:-translate-y-px hover:shadow-[0_10px_20px_-5px_rgba(28,34,43,.12)] focus-visible:ring-2 focus-visible:ring-(--ring)"
            style={{
              top: `${(seg.start / DAY_MIN) * 100}%`,
              height: `${(minutes / DAY_MIN) * 100}%`,
              minHeight: 4,
              background: fillOf(color),
              outline: exception ? '1.5px dashed rgba(41,41,41,0.5)' : undefined,
              outlineOffset: exception ? -1.5 : undefined,
            }}
          />
        }
      >
        {minutes >= 40 ? (
          <div className="flex min-h-0 flex-1 flex-col px-1.5 py-1.5 text-[11px] leading-4">
            <span className={cn('font-medium [overflow-wrap:anywhere]', minutes >= 90 ? 'line-clamp-2' : 'truncate')}>{label}</span>
            {minutes >= 90 ? (
              <span className="truncate text-[10.5px] text-[rgba(41,41,41,.6)] tabular-nums">
                <span className="@[96px]:hidden">{hhmm(seg.start)}</span>
                <span className="hidden @[96px]:inline">{range.replace(' – ', '–')}</span>
              </span>
            ) : null}
            {exception && minutes >= 150 ? (
              <span className="mt-auto truncate pt-1 text-[10.5px] text-[rgba(41,41,41,.7)]">{exceptionName(p.s.exceptions[seg.source as number].period, p.s.row.device, calendars)}</span>
            ) : null}
          </div>
        ) : null}
      </TooltipTrigger>
      <TooltipPopup side="right">
        <div className="text-[12px] font-medium">{label}</div>
        <div className="text-[11.5px] tabular-nums opacity-70">
          {fmtDay(day, { weekday: 'short', day: 'numeric', month: 'short' })} · {range}
        </div>
        <div className="text-[11.5px] opacity-70">{sourceText(seg, p, calendars)}</div>
      </TooltipPopup>
    </Tooltip>
  )
}

function MonthGrid({ p, days, month, calendars, now, onDay }: { p: Prepared; days: Date[]; month: number; calendars: Calendars; now: Date; onDay: (d: Date) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 pt-3 pb-4 [scrollbar-width:thin]">
      <div className="grid min-w-[560px] grid-cols-7 gap-1.5 pb-2">
        {DAY_SHORT.map((d) => (
          <div key={d} className="pl-1 text-[12px] text-(--text-muted)">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-[420px] min-w-[560px] flex-1 grid-cols-7 grid-rows-6 gap-1.5">
        {days.map((d, i) => {
          const segs = daySegments(p.s, d, calendars)
          const off = segs.length === 1 && segs[0].source === 'off'
          const today = sameDay(d, now)
          const exIdx = segs.find((s) => typeof s.source === 'number')?.source as number | undefined
          return (
            <button
              key={i}
              onClick={() => onDay(d)}
              title="Open this week"
              className={cn(
                'group flex min-h-[64px] flex-col rounded-[10px] border border-[rgba(41,41,41,0.06)] bg-[#fafafa] p-1.5 text-left transition-colors hover:border-(--border-strong)',
                d.getMonth() !== month && 'opacity-45',
              )}
              style={off ? { backgroundImage: HATCH } : undefined}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'inline-flex size-[22px] items-center justify-center rounded-full text-[12px] tabular-nums',
                    today ? 'bg-(--ink) font-medium text-white' : 'text-(--text-strong)',
                  )}
                >
                  {d.getDate()}
                </span>
                {exIdx !== undefined ? (
                  <span className="min-w-0 truncate rounded-full border border-dashed border-(--ink-3) px-1.5 text-[10.5px] leading-4 text-(--text-muted)">
                    {exceptionName(p.s.exceptions[exIdx].period, p.s.row.device, calendars)}
                  </span>
                ) : null}
              </div>
              <div className="flex-1" />
              {off ? (
                <span className="text-[10.5px] text-(--text-faint)">Not in effect</span>
              ) : (
                <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-[rgba(41,41,41,0.06)]">
                  {segs
                    .filter((s) => s.source !== 'default' && s.value && s.value.type !== 'null')
                    .map((s, k) => (
                      <span
                        key={k}
                        className="absolute inset-y-0"
                        style={{ left: `${(s.start / DAY_MIN) * 100}%`, width: `${((s.end - s.start) / DAY_MIN) * 100}%`, background: p.color(s.value) }}
                      />
                    ))}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

