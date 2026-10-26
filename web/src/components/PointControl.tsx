import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { api, type ControlAction, type ControlField, type ControlPoint, type ControlResult, type ObjectRow } from '../api'
import { actionValue, propertyLabel, undoAction, weekChange } from '../actions'
import type { FieldShape } from '../fields'
import { INLINE_KINDS, bitLabel } from '../fields'
import { useControl } from './ControlState'
import { PropertyWrite } from './PropertyWrite'
import { PRIORITY_NAMES, WRITABLE_TYPES, unitLabel, winningSlot } from '../control'
import { Button } from '../ui/components/button'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Skeleton } from '../ui/components/skeleton'
import { cn } from '../ui/utils'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const PRIORITIES = Array.from({ length: 16 }, (_, i) => i + 1)

/** A slot or value as words: a state's label, or the number and its units. */
function short(point: ControlPoint, value: number | null, withUnits = true) {
  if (value === null) return '—'
  const choice = point.choices.find((c) => c.value === value)
  if (choice) return choice.label
  const n = String(Number(value.toPrecision(7)))
  return withUnits && point.units && point.units !== 'no-units' ? `${n} ${unitLabel(point.units)}` : n
}

/** Read-only things worth seeing at a glance. Anything writable is under Settings or Alarm; the rest is on Properties. */
const DETAILS: [string, string][] = [
  ['status-flags', 'Status flags'],
  ['event-state', 'Event state'],
  ['acked-transitions', 'Acknowledged'],  // shown in words below
  ['Device name', 'Device'],
]

/** Settings first in the order a commissioning engineer looks for them; anything else follows alphabetically. */
const SETTINGS_ORDER = ['relinquish-default', 'out-of-service', 'description', 'cov-increment', 'min-pres-value', 'max-pres-value', 'units',
  'priority-for-writing', 'schedule-default', 'effective-period', 'weekly-schedule', 'exception-schedule', 'date-list']
/** Real-valued properties measured in the point's own units. */
const IN_UNITS = new Set(['relinquish-default', 'high-limit', 'low-limit', 'deadband', 'cov-increment', 'min-pres-value', 'max-pres-value', 'fault-high-limit', 'fault-low-limit', 'setpoint'])
const ALARM_LABEL: Record<string, string> = { 'event-enable': 'Report transitions', 'limit-enable': 'Limits enabled', 'notification-class': 'Notification class', 'alarm-value': 'Alarm when' }

const clock = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
const day = (t: number) => new Date(t * 1000).toDateString() === new Date().toDateString() ? clock(t) : new Date(t * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + clock(t)

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between px-2 pt-4 pb-1.5">
        <span className="text-[12px] text-(--text-muted)">{title}</span>
        {aside ? <span className="text-[11px] text-(--text-faint)">{aside}</span> : null}
      </div>
      {children}
    </section>
  )
}

function Pill({ tone = 'neutral', children }: { tone?: 'neutral' | 'info' | 'warn' | 'alarm'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex h-[22px] items-center rounded-full px-2.5 text-[11.5px] whitespace-nowrap',
        tone === 'neutral' && 'bg-(--surface-track) text-(--text-muted)',
        tone === 'info' && 'bg-(--status-info-bg)',
        tone === 'warn' && 'bg-(--status-warn-bg)',
        tone === 'alarm' && 'bg-(--status-alarm-bg)',
      )}
    >
      {children}
    </span>
  )
}

/**
 * A point at a glance: its live value, a command box and the 16-level priority array. Values are read live from the
 * controller when the drawer opens; a write is confirmed in place, verified by reading back, and logged.
 */
export function PointControl({ row, canWrite, reloadSignal, onWritten, onOpenSchedules }: { row: ObjectRow; canWrite: boolean; reloadSignal: number; onWritten: () => void; onOpenSchedules?: () => void }) {
  const control = useControl()
  const hasValue = row.values['present-value'] !== undefined
  const writable = WRITABLE_TYPES.has(row.typeId) && hasValue
  const [point, setPoint] = useState<ControlPoint | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState('')
  const [priority, setPriority] = useState(8)
  const [confirm, setConfirm] = useState<{ value: number | null; release: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ControlResult | { state: 'error'; message: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      const [next] = await api.controlPrepare([row])
      if (next?.error) {
        setPoint(null)
        setLoadError(next.error)
      } else setPoint(next ?? null)
    } catch (e) {
      setLoadError(message(e))
    } finally {
      setLoading(false)
    }
    // re-read only for a different point or an explicit refresh, not for every new row object
  }, [row.key]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!writable || !canWrite) return
    // live control metadata is external state; defer so mount stays pure
    const task = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(task)
  }, [writable, canWrite, load, reloadSignal])

  const live = point && !point.error ? point : null
  const winner = live ? winningSlot(live) : null
  const analog = live?.kind === 'analog'
  const units = live ? (live.units && live.units !== 'no-units' && live.units !== 'unknown units' ? unitLabel(live.units) : '') : row.values.units ?? ''
  const shown = live ? short(live, live.current, false) : row.values['present-value'] ?? '—'
  const state = live && !analog ? live.current : null

  const parsed = (): { value: number } | { error: string } => {
    if (!live) return { error: 'Not ready' }
    if (!draft.trim()) return { error: analog ? 'Enter a value' : 'Choose a state' }
    const value = Number(draft)
    if (!Number.isFinite(value)) return { error: 'Enter a number' }
    if (live.minimum !== null && value < live.minimum) return { error: `Below the minimum of ${short(live, live.minimum)}` }
    if (live.maximum !== null && value > live.maximum) return { error: `Above the maximum of ${short(live, live.maximum)}` }
    return { value }
  }
  const check = parsed()

  async function send() {
    if (!live || !confirm) return
    setBusy(true)
    try {
      const r = await api.controlWrite(live.token, confirm.value, live.commandable ? priority : null, confirm.release)
      setResult(r)
      if (r.state === 'verified') setDraft('')
    } catch (e) {
      setResult({ state: 'error', message: message(e) })
    } finally {
      setBusy(false)
      setConfirm(null)
      onWritten()
      control.refresh()
      void load() // the review token is spent; read the point again either way
    }
  }

  const flags = row.values['status-flags'] ?? ''
  const inAlarm = flags.includes('in-alarm')
  const fault = flags.includes('fault')
  const overridden = flags.includes('overridden')
  const outOfService = /true/i.test(row.values['out-of-service'] ?? '')
  const details = DETAILS.filter(([key]) => row.values[key] !== undefined && row.values[key] !== '')
  const alarmSet = new Set(control.writable?.alarm ?? [])
  const fields = control.fieldsOf(row)
  const rank = (p: string) => (SETTINGS_ORDER.includes(p) ? SETTINGS_ORDER.indexOf(p) : 100)
  const settings = fields.filter(([p]) => !alarmSet.has(p)).sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
  const alarm = (control.writable?.alarm ?? []).map((p) => fields.find(([q]) => q === p)).filter((f): f is (typeof fields)[number] => !!f)
  const unitText = row.values.units && row.values.units !== 'no-units' ? unitLabel(row.values.units) : ''
  // state labels for a binary or multistate default or alarm value, from the live point
  const shapeOf = (property: string) => (f: ControlField): FieldShape => {
    if ((property === 'relinquish-default' || property === 'alarm-value') && live && live.kind !== 'analog') return { kind: 'enumerated', choices: live.choices }
    return { kind: f.kind, choices: f.choices, bits: f.bits, units: f.kind === 'real' && IN_UNITS.has(property) ? unitText : undefined }
  }
  const afterSetting = () => {
    onWritten()
    if (writable && canWrite) void load()
  }
  const held = new Set((control.heldByKey.get(row.key) ?? []).map((h) => h.priority))
  const history = control.log.actions.filter((a) => a.key === row.key).slice(0, 8)

  return (
    <div className="flex flex-col px-2.5 pb-3">
      {/* the value */}
      {hasValue ? (
      <div className="mx-0.5 mt-1 rounded-[14px] bg-(--surface-card-muted) px-4 pt-3 pb-3.5">
        <div className="flex items-center justify-between text-[11px] text-(--text-faint)">
          <span>Present value</span>
          {writable && canWrite ? (
            loading ? <span>Reading live…</span> : live ? <span className="inline-flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-(--status-ok)" />Live</span> : null
          ) : null}
        </div>
        <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[28px] leading-9 font-medium tracking-[-0.02em] tabular-nums" title={String(shown)}>{shown}</span>
          {units ? <span className="shrink-0 text-[14px] text-(--text-muted)">{units}</span> : null}
          {state !== null ? <span className="shrink-0 text-[12px] text-(--text-faint) tabular-nums">state {state}</span> : null}
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {live?.commandable ? (
            winner ? (
              <Pill tone={winner === 8 ? 'info' : 'warn'}>
                Priority {winner}{PRIORITY_NAMES[winner] ? ` · ${PRIORITY_NAMES[winner]}` : ''}
              </Pill>
            ) : (
              <Pill>Relinquish default</Pill>
            )
          ) : null}
          {outOfService ? <Pill tone="warn">Out of service</Pill> : null}
          {inAlarm ? <Pill tone="alarm">In alarm</Pill> : null}
          {fault ? <Pill tone="alarm">Fault</Pill> : null}
          {overridden ? <Pill tone="warn">Overridden</Pill> : null}
          {row.values['reliability'] && !/no-fault/i.test(row.values['reliability']) ? <Pill tone="alarm">{row.values['reliability']}</Pill> : null}
          {held.size ? <Pill tone="info">BACon holds P{[...held].join(', P')}</Pill> : null}
        </div>
      </div>
      ) : null}

      {/* the command */}
      {writable ? (
        <Section title="Command" aside={live ? (live.commandable ? 'Priority write' : 'Direct write') : undefined}>
          {!canWrite ? (
            <p className="m-0 mx-0.5 rounded-[12px] border border-dashed border-(--border-default) px-3 py-2.5 text-[12.5px] text-(--text-muted)">Connect to the network to command this point.</p>
          ) : loading && !live ? (
            <div className="mx-0.5 flex flex-col gap-2">
              <Skeleton className="h-9 rounded-[10px]" />
              <Skeleton className="h-9 rounded-[10px]" />
            </div>
          ) : !live ? (
            <div className="mx-0.5 flex items-start justify-between gap-3 rounded-[12px] bg-(--status-alarm-bg) px-3 py-2.5 text-[12.5px] leading-snug">
              <span>{loadError || 'Could not read the point.'}</span>
              <Button size="xs" variant="ghost" className="-my-1" onClick={() => void load()}>Retry</Button>
            </div>
          ) : (
            <div className="mx-0.5 flex flex-col gap-2.5 rounded-[14px] border border-(--border-subtle) p-3">
              {analog ? (
                <label className="flex h-9 items-center gap-2 rounded-[10px] border border-(--border-default) bg-(--surface-input) px-3 focus-within:border-(--ring)">
                  <Input
                    unstyled
                    nativeInput
                    aria-label="New value"
                    role="spinbutton"
                    inputMode="decimal"
                    className="h-full min-w-0 flex-1 text-[14px] tabular-nums"
                    placeholder={short(live, live.current, false)}
                    value={draft}
                    disabled={busy || !!confirm}
                    onChange={(e) => { setDraft(e.target.value); setResult(null) }}
                    onKeyDown={(e) => { if (e.key === 'Enter' && 'value' in check) setConfirm({ value: check.value, release: false }) }}
                  />
                  {units ? <span className="text-[13px] text-(--text-muted)">{units}</span> : null}
                </label>
              ) : live.choices.length <= 4 ? (
                <div role="radiogroup" aria-label="New state" className="grid gap-1 rounded-[11px] bg-(--surface-track) p-[3px]" style={{ gridTemplateColumns: `repeat(${live.choices.length}, minmax(0, 1fr))` }}>
                  {live.choices.map((c) => {
                    const on = draft === String(c.value)
                    return (
                      <button
                        key={c.value}
                        role="radio"
                        aria-checked={on}
                        disabled={busy || !!confirm}
                        onClick={() => { setDraft(String(c.value)); setResult(null) }}
                        className={cn(
                          'h-8 min-w-0 truncate rounded-[8px] px-2 text-[12.5px] transition-colors',
                          on ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-(--text-muted) hover:text-(--text-strong)',
                        )}
                        title={`${c.label} · ${c.value}`}
                      >
                        {c.label}
                        {c.value === live.current ? <span className="ml-1 text-(--text-faint)">•</span> : null}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <Select value={draft || null} items={live.choices.map((c) => ({ value: String(c.value), label: c.label }))} onValueChange={(v) => { setDraft(String(v)); setResult(null) }}>
                  <SelectTrigger aria-label="New state" disabled={busy || !!confirm}><SelectValue placeholder="Choose a state" /></SelectTrigger>
                  <SelectPopup>{live.choices.map((c) => <SelectItem key={c.value} value={String(c.value)}>{c.label} · {c.value}</SelectItem>)}</SelectPopup>
                </Select>
              )}
              {analog && (live.minimum !== null || live.maximum !== null) ? (
                <div className="-mt-1 px-1 text-[11px] text-(--text-faint)">Limits {live.minimum !== null ? short(live, live.minimum) : '—'} to {live.maximum !== null ? short(live, live.maximum) : '—'}</div>
              ) : null}

              {live.commandable ? (
                <div className="flex items-center justify-between gap-3 text-[12.5px]">
                  <span className="text-(--text-muted)">At priority</span>
                  <Select value={String(priority)} items={PRIORITIES.filter((n) => n !== 6).map((n) => ({ value: String(n), label: `${n}${PRIORITY_NAMES[n] ? ` · ${PRIORITY_NAMES[n]}` : ''}` }))} onValueChange={(v) => { setPriority(Number(v)); setConfirm(null) }}>
                    <SelectTrigger aria-label="Priority" className="w-auto min-w-[190px]" disabled={busy}><SelectValue /></SelectTrigger>
                    <SelectPopup>
                      {PRIORITIES.filter((n) => n !== 6).map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}{PRIORITY_NAMES[n] ? ` · ${PRIORITY_NAMES[n]}` : ''}
                          {live.slots?.[n - 1] != null ? <span className="ml-2 text-(--text-faint)">{short(live, live.slots[n - 1])}</span> : null}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}

              {confirm ? (
                <div className="flex flex-col gap-2 rounded-[11px] bg-(--surface-checked) px-3 py-2.5">
                  <div className="text-[12.5px] leading-snug">
                    {confirm.release ? (
                      <>Release priority {priority} on <b className="font-medium">{live.name}</b>?</>
                    ) : (
                      <>Send <b className="font-medium">{short(live, confirm.value)}</b>{live.commandable ? <> at priority {priority}</> : null} to <b className="font-medium">{live.name}</b>?</>
                    )}
                    <div className="mt-0.5 text-[11.5px] text-(--text-muted)">
                      {live.commandable
                        ? live.slots?.[priority - 1] != null
                          ? `Replaces ${short(live, live.slots[priority - 1])} in that slot.`
                          : 'That slot is empty.'
                        : `Replaces ${short(live, live.current)}.`}
                      {live.commandable && winner !== null && winner < priority && !confirm.release ? ` Priority ${winner} stays in control.` : ''}
                    </div>
                  </div>
                  <div className="flex justify-end gap-1.5">
                    <Button size="xs" variant="ghost" disabled={busy} onClick={() => setConfirm(null)}>Cancel</Button>
                    <Button size="xs" loading={busy} onClick={() => void send()}>{confirm.release ? 'Release' : 'Send'}</Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-1.5">
                  {live.commandable ? (
                    <Button size="xs" variant="secondary" disabled={live.slots?.[priority - 1] == null} onClick={() => { setResult(null); setConfirm({ value: null, release: true }) }}>
                      Release {priority}
                    </Button>
                  ) : null}
                  <Button size="xs" disabled={!('value' in check)} title={'error' in check ? check.error : undefined} onClick={() => 'value' in check && setConfirm({ value: check.value, release: false })}>
                    Write
                  </Button>
                </div>
              )}

              {result ? (
                <p
                  role="status"
                  className={cn(
                    'm-0 rounded-[10px] px-3 py-2 text-[12px] leading-snug',
                    result.state === 'verified' ? 'bg-(--status-ok-bg)' : result.state === 'rejected' || result.state === 'error' ? 'bg-(--status-alarm-bg)' : 'bg-(--status-warn-bg)',
                  )}
                >
                  {result.message}
                </p>
              ) : null}
            </div>
          )}
        </Section>
      ) : null}

      {/* the priority array */}
      {live?.commandable && live.slots ? (
        <Section title="Priority array" aside={winner ? `${live.slots.filter((v) => v !== null).length} of 16 in use` : 'all released'}>
          <div className="mx-0.5 grid grid-cols-4 gap-1">
            {live.slots.map((v, i) => {
              const n = i + 1
              const active = n === winner
              return (
                <button
                  key={n}
                  disabled={n === 6 || busy}
                  onClick={() => { setPriority(n); setConfirm(null) }}
                  title={`Priority ${n}${PRIORITY_NAMES[n] ? ` · ${PRIORITY_NAMES[n]}` : ''}${v !== null ? ` · ${short(live, v)}` : ' · released'}`}
                  className={cn(
                    'flex h-[46px] min-w-0 flex-col justify-center rounded-[10px] px-2 text-left transition-colors',
                    v === null ? 'bg-(--surface-card-muted) hover:bg-(--surface-hover)' : 'bg-(--surface-track) hover:bg-(--surface-hover)',
                    active && 'bg-(--surface-checked) shadow-[inset_0_0_0_1px_var(--status-info)] hover:bg-(--surface-checked)',
                    n === priority && !active && 'shadow-[inset_0_0_0_1px_var(--border-strong)]',
                    n === 6 && 'cursor-default opacity-60',
                  )}
                >
                  <span className={cn('flex items-center justify-between text-[10.5px] tabular-nums', active ? 'text-(--text-strong)' : 'text-(--text-faint)')}>
                    P{n}
                    {held.has(n) ? <span className="rounded-full bg-(--surface-card) px-1 text-[9.5px] leading-[14px] text-(--text-muted)">BACon</span> : null}
                  </span>
                  <span className={cn('truncate text-[12.5px] tabular-nums', v === null ? 'text-(--text-faint)' : 'font-medium')}>{short(live, v)}</span>
                </button>
              )
            })}
          </div>
          <div className={cn('mx-0.5 mt-1 flex h-9 items-center justify-between rounded-[10px] px-3 text-[12.5px]', winner === null ? 'bg-(--surface-checked) shadow-[inset_0_0_0_1px_var(--status-info)]' : 'bg-(--surface-card-muted)')}>
            <span className="text-(--text-muted)">Relinquish default</span>
            <span className="tabular-nums">{short(live, live.relinquishDefault)}</span>
          </div>
        </Section>
      ) : null}

      {/* everything else that can be written */}
      {settings.length ? (
        <Section title="Settings" aside={canWrite ? 'read live when you edit' : 'connect to edit'}>
          <div className="mx-0.5 flex flex-col rounded-[14px] border border-(--border-subtle) p-1">
            {settings.map(([property, spec]) =>
              INLINE_KINDS.has(spec.kind) ? (
                <PropertyWrite key={property} row={row} property={property} spec={spec} label={propertyLabel(property)} shapeOf={shapeOf(property)} canWrite={canWrite} onWritten={afterSetting} />
              ) : (
                <div key={property} className="flex min-h-8 items-center justify-between gap-3 px-2 text-[12.5px]">
                  <span className="text-(--text-muted)">{propertyLabel(property)}</span>
                  {onOpenSchedules ? <Button size="xs" variant="ghost" className="-mr-1" onClick={onOpenSchedules}>Edit in Schedules</Button> : <span className="text-(--text-faint)">in Schedules</span>}
                </div>
              ),
            )}
          </div>
        </Section>
      ) : null}

      {/* intrinsic alarming on the point */}
      {alarm.length ? (
        <Section title="Alarm" aside={row.values['event-state'] && row.values['event-state'] !== 'normal' ? row.values['event-state'] : 'on this point'}>
          <div className="mx-0.5 flex flex-col rounded-[14px] border border-(--border-subtle) p-1">
            {alarm.map(([property, spec]) => (
              <PropertyWrite key={property} row={row} property={property} spec={spec} label={ALARM_LABEL[property] ?? propertyLabel(property)} shapeOf={shapeOf(property)} canWrite={canWrite} onWritten={afterSetting} />
            ))}
          </div>
        </Section>
      ) : null}

      {/* what BACon did here */}
      {history.length ? (
        <Section title="BACon on this point" aside={`${history.length === 8 ? 'latest 8' : history.length} · see Activity`}>
          <div className="mx-0.5 flex flex-col rounded-[14px] border border-(--border-subtle) p-1">
            {history.map((a) => <HistoryRow key={a.id} action={a} canWrite={canWrite} onDone={() => { control.refresh(); onWritten(); void load() }} />)}
          </div>
        </Section>
      ) : null}

      {/* the essentials */}
      {details.length ? (
        <Section title="Details">
          <dl className="m-0 mx-0.5 flex flex-col rounded-[14px] border border-(--border-subtle) px-3 py-1.5">
            {details.map(([key, label]) => (
              <div key={key} className="flex min-h-7 items-center justify-between gap-4 text-[12.5px]">
                <dt className="shrink-0 text-(--text-muted)">{label}</dt>
                <dd className="m-0 min-w-0 truncate text-right tabular-nums" title={row.values[key]}>
                  {key === 'acked-transitions' ? (row.values[key].split(';').length >= 3 ? 'All transitions' : row.values[key].split(';').filter(Boolean).map(bitLabel).join(', ') || 'None') : row.values[key]}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ) : null}
    </div>
  )
}

const STATE_DOT: Record<string, string> = { verified: 'bg-(--status-ok)', rejected: 'bg-(--status-alarm)', unknown: 'bg-(--status-warn)', sending: 'bg-(--status-warn)' }

/** One thing BACon did: when, what, the outcome, and a way to put it back. */
function HistoryRow({ action: a, canWrite, onDone }: { action: ControlAction; canWrite: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const undoable = a.property !== 'acknowledge' && (a.state === 'verified' || a.state === 'unknown')
  const what = a.property === 'present-value' ? (a.release ? `Released P${a.priority}` : `${actionValue(a, a.value)}${a.priority ? ` at P${a.priority}` : ''}`) : a.property === 'acknowledge' ? actionValue(a, a.value) : `${propertyLabel(a.property)} → ${weekChange(a) ?? actionValue(a, a.value)}`
  return (
    <div className="group/hist flex min-h-8 items-center gap-2 px-2 text-[12px]">
      <span className={cn('size-1.5 shrink-0 rounded-full', STATE_DOT[a.state] ?? 'bg-(--text-faint)')} title={a.message ?? a.state} />
      <span className="w-[74px] shrink-0 text-[11px] tabular-nums text-(--text-faint)">{day(a.at)}</span>
      <span className="min-w-0 flex-1 truncate" title={`${what}${a.message ? ` · ${a.message}` : ''}${note ? ` · ${note}` : ''}`}>{what}{note ? <span className="text-(--text-muted)"> · {note}</span> : null}</span>
      {undoable ? (
        <Button size="xs" variant="ghost" className="h-6 shrink-0 px-1.5 opacity-0 group-hover/hist:opacity-100 focus-visible:opacity-100" loading={busy} disabled={!canWrite}
          title={a.property === 'present-value' && a.priority ? (a.slotBefore == null ? `Release P${a.priority}` : `Put P${a.priority} back to ${actionValue(a, a.slotBefore)}`) : `Put back ${actionValue(a, a.before)}`}
          onClick={async () => {
            setBusy(true)
            try {
              const r = await undoAction(a)
              setNote(r.state === 'verified' ? 'undone' : r.message)
            } catch (e) {
              setNote(message(e))
            } finally {
              setBusy(false)
              onDone()
            }
          }}>
          Undo
        </Button>
      ) : null}
    </div>
  )
}
