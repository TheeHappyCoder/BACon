import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ControlField, type ControlPoint, type ControlResult, type FieldResult, type ObjectRow } from '../api'
import { propertyLabel } from '../actions'
import { PRIORITY_NAMES, WRITABLE_TYPES, convert, convertDelta, groupPoints, stateFor, valueLabel, unitLabel, type WriteGroup } from '../control'
import { INLINE_KINDS, draftOf, formatField, parseDraft, type FieldShape } from '../fields'
import { Button } from '../ui/components/button'
import type React from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Skeleton } from '../ui/components/skeleton'
import { Switch } from '../ui/components/switch'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '../ui/components/sheet'
import { cn } from '../ui/utils'
import { useControl } from './ControlState'
import { FieldEditor } from './FieldEditor'
import { NumberField } from './NumberField'
import { Tick } from './Tick'

const { Activity, ToggleLeft, List, SlidersHorizontal, Check, ArrowRight, ChevronDown } = Hugeicons

type Draft = { value: string; priority: string; release: boolean; enabled: boolean; how: 'set' | 'shift' }
/** One point's write as planned from its group's draft, or why it cannot take it. */
type Plan = { point: ControlPoint; value: number | null; priority: number | null; release: boolean; problem?: string; skip?: string }
type Command = { point: ControlPoint; value: number | null; priority: number | null; release: boolean }
type FieldGroup = { shape: FieldShape; fields: ControlField[] }
type FieldCommand = { field: ControlField; shape: FieldShape; value: unknown }
type Outcome = { key: string; state: string; message: string; current?: unknown }
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
const PV = 'present-value'
const IN_UNITS = new Set(['relinquish-default', 'high-limit', 'low-limit', 'deadband', 'cov-increment', 'min-pres-value', 'max-pres-value', 'fault-high-limit', 'fault-low-limit'])
const PRIORITIES = Array.from({ length: 16 }, (_, i) => i + 1).filter((n) => n !== 6).map((n) => ({ value: String(n), label: `${n}${PRIORITY_NAMES[n] ? ` · ${PRIORITY_NAMES[n]}` : ''}` }))

/** Run one write per item, a few devices side by side (each device takes one write at a time on the server). */
async function runAll<T>(items: T[], fn: (item: T) => Promise<void>, stop: () => boolean, width = 4) {
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]
      await fn(item)
      if (stop()) return
    }
  }
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker))
}

const round = (v: number) => Number(v.toPrecision(7))

/**
 * Each point's own write for a group's draft: the value converted into its units (or moved by the change, from its own
 * current value), the number its controller uses for the chosen state, its priority if it has a priority array. A
 * value outside a point's limits is a problem; a release on a point written directly is skipped.
 */
function planGroup(group: WriteGroup, d: Draft): { items: Plan[]; error?: string } {
  const priority = Number(d.priority)
  if (d.release) {
    return { items: group.points.map((point) => (point.commandable ? { point, value: null, priority, release: true } : { point, value: null, priority: null, release: true, skip: 'written directly, nothing to release' })) }
  }
  if (!d.value.trim()) return { items: [], error: group.kind === 'analog' ? 'Type a value' : 'Choose a state' }
  const n = Number(d.value)
  if (!Number.isFinite(n)) return { items: [], error: `"${d.value}" is not a number` }
  const items = group.points.map((point): Plan => {
    let value: number | null
    if (group.labels) {
      const label = group.labels[n]
      value = label === undefined ? null : stateFor(point, label)
      if (value === null) return { point, value: null, priority: null, release: false, problem: `has no state "${label}"` }
    } else {
      value = round(d.how === 'shift' ? point.current + convertDelta(n, group.units, point.units) : convert(n, group.units, point.units))
    }
    const out: Plan = { point, value, priority: point.commandable ? priority : null, release: false }
    if ((point.minimum !== null && value < point.minimum) || (point.maximum !== null && value > point.maximum)) {
      out.problem = `${valueLabel(point, value)} is outside its limits, ${point.minimum ?? '—'} to ${point.maximum ?? '—'}`
    }
    return out
  })
  return { items }
}

/** A binary or multistate object's states from its last read, for its default and alarm value. */
function stateChoices(row: ObjectRow) {
  if ([3, 4, 5].includes(row.typeId)) return [{ value: 0, label: row.values['inactive-text'] || 'Inactive' }, { value: 1, label: row.values['active-text'] || 'Active' }]
  if ([13, 14, 19].includes(row.typeId) && row.values['state-text']) return row.values['state-text'].split('; ').map((label, i) => ({ value: i + 1, label: label || `State ${i + 1}` }))
  return null
}

/**
 * Write many points at once. Present value groups points that take the same value the same way (units, state labels,
 * priority or direct); any other property groups by what it takes. Every group is reviewed before anything is sent,
 * every write is verified on its own, and every result is listed.
 */
export function WritePointsSheet({ rows, onClose, onWritten }: { rows: ObjectRow[]; onClose: () => void; onWritten: () => void }) {
  const control = useControl()
  const { fieldsOf } = control
  const commandable = useMemo(() => rows.filter((r) => WRITABLE_TYPES.has(r.typeId) && r.values[PV] !== undefined), [rows])
  const [property, setProperty] = useState(() => (commandable.length ? PV : ''))
  const [points, setPoints] = useState<ControlPoint[]>([])
  const [fields, setFields] = useState<ControlField[]>([])
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [fieldDrafts, setFieldDrafts] = useState<{ value: unknown; enabled: boolean }[]>([])
  const [excluded, setExcluded] = useState(new Set<string>())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [review, setReview] = useState<Command[] | null>(null)
  const [fieldReview, setFieldReview] = useState<FieldCommand[] | null>(null)
  const [results, setResults] = useState<Outcome[]>([])
  const [busy, setBusy] = useState(false)
  const cancel = useRef(false)

  // what the selection has in common: present value, and every writable property at least one of them has
  const options = useMemo(() => {
    const count = new Map<string, number>()
    for (const r of rows) for (const [p, spec] of fieldsOf(r)) if (INLINE_KINDS.has(spec.kind)) count.set(p, (count.get(p) ?? 0) + 1)
    const props = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    return [...(commandable.length ? [{ value: PV, label: `Present value · ${commandable.length}` }] : []), ...props.map(([p, n]) => ({ value: p, label: `${propertyLabel(p)} · ${n}` }))]
  }, [rows, commandable, fieldsOf])
  // nothing commandable: start on the most common property
  if (!property && options.length) setProperty(options[0].value)
  const targets = useMemo(() => (property === PV ? commandable : rows.filter((r) => fieldsOf(r).some(([p]) => p === property))), [rows, commandable, property, fieldsOf])
  const rowOf = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])

  const groups = groupPoints(points)
  const fieldGroups = useMemo<FieldGroup[]>(() => {
    const map = new Map<string, FieldGroup>()
    for (const f of fields) {
      if (f.error) continue
      const row = rowOf.get(f.key)!
      const states = (property === 'relinquish-default' || property === 'alarm-value') ? stateChoices(row) : null
      const units = f.kind === 'real' && IN_UNITS.has(property) && row.values.units && row.values.units !== 'no-units' ? unitLabel(row.values.units) : undefined
      const shape: FieldShape = states ? { kind: 'enumerated', choices: states } : { kind: f.kind, choices: f.choices, bits: f.bits, units }
      const id = JSON.stringify(shape)
      map.set(id, { shape, fields: [...(map.get(id)?.fields ?? []), f] })
    }
    return [...map.values()]
  }, [fields, rowOf, property])

  const load = useCallback(async () => {
    if (!property) return
    setLoading(true); setError(''); setReview(null); setFieldReview(null); setResults([]); setExcluded(new Set())
    try {
      if (property === PV) {
        const next = await api.controlPrepare(targets)
        setPoints(next); setFields([])
        setDrafts(groupPoints(next).map(() => ({ value: '', priority: '8', release: false, enabled: false, how: 'set' })))
      } else {
        const next = await api.fieldPrepare(targets, property)
        setFields(next); setPoints([])
      }
    } catch (e) { setError(message(e)) }
    finally { setLoading(false) }
  }, [targets, property])
  useEffect(() => {
    // Live metadata is external state. Defer the initial load so mount stays pure.
    const task = window.setTimeout(() => { void load() }, 0)
    return () => window.clearTimeout(task)
  }, [load])
  // a new set of field groups starts from the first point's value, switched off
  const [seenGroups, setSeenGroups] = useState(fieldGroups)
  if (seenGroups !== fieldGroups) {
    setSeenGroups(fieldGroups)
    setFieldDrafts(fieldGroups.map((g) => ({ value: draftOf(g.shape.kind, g.fields[0].current), enabled: false })))
  }

  function edit(index: number, change: Partial<Draft>) {
    setDrafts((all) => all.map((d, i) => i === index ? { ...d, ...change } : d))
  }
  const include = (key: string, on: boolean) => setExcluded((old) => { const next = new Set(old); if (on) next.delete(key); else next.add(key); return next })

  function prepareReview() {
    try {
      if (property !== PV) {
        const commands: FieldCommand[] = []
        fieldGroups.forEach((g, i) => {
          const d = fieldDrafts[i]
          if (!d?.enabled) return
          const parsed = parseDraft(g.shape, d.value)
          if ('error' in parsed) throw new Error(`Group ${i + 1}: ${parsed.error}.`)
          for (const f of g.fields.filter((f) => !excluded.has(f.key))) commands.push({ field: f, shape: g.shape, value: parsed.value })
        })
        if (!commands.length) throw new Error('Switch on a group and include at least one point.')
        setError(''); setFieldReview(commands)
        return
      }
      const commands: Command[] = []
      groups.forEach((group, i) => {
        const draft = drafts[i]
        if (!draft.enabled) return
        const { items, error } = planGroup(group, draft)
        if (error) throw new Error(`${groupTitle(group)}: ${error.toLowerCase()}.`)
        for (const item of items.filter((x) => !excluded.has(x.point.key) && !x.skip)) {
          if (item.problem) throw new Error(`${item.point.name}: ${item.problem}. Change the value or leave this point out.`)
          commands.push({ point: item.point, value: item.value, priority: item.priority, release: item.release })
        }
      })
      if (!commands.length) throw new Error('Enable a group and include at least one point.')
      setError(''); setReview(commands)
    } catch (e) { setError(message(e)) }
  }

  async function apply() {
    if (busy) return
    setBusy(true); cancel.current = false
    const record = (r: Outcome) => setResults((all) => [...all, r])
    if (review) {
      await runAll(review, async ({ point, value, priority, release }) => {
        if (cancel.current) return record({ key: point.key, state: 'skipped', message: 'Stopped before sending.' })
        try { record(await api.controlWrite(point.token, value, priority, release) as ControlResult) }
        catch (e) { record({ key: point.key, state: 'unknown', message: message(e) }) }
      }, () => false)
    } else if (fieldReview) {
      await runAll(fieldReview, async ({ field, value }) => {
        if (cancel.current) return record({ key: field.key, state: 'skipped', message: 'Stopped before sending.' })
        try { record(await api.fieldWrite(field.token, value) as FieldResult) }
        catch (e) { record({ key: field.key, state: 'unknown', message: message(e) }) }
      }, () => false)
    }
    setBusy(false); control.refresh(); onWritten()
  }

  const reviewing = review ?? fieldReview
  const total = reviewing?.length ?? 0
  const verified = results.filter((r) => r.state === 'verified').length
  const failedPoints = points.filter((p) => p.error).concat(fields.filter((f) => f.error) as unknown as ControlPoint[])
  const groupCount = property === PV ? groups.length : fieldGroups.length
  const step = results.length || busy ? 3 : reviewing ? 2 : 1
  // what is about to go out, for the footer
  const pending =
    property === PV
      ? groups.reduce((n, g, i) => n + (drafts[i]?.enabled ? g.points.filter((p) => !excluded.has(p.key)).length : 0), 0)
      : fieldGroups.reduce((n, g, i) => n + (fieldDrafts[i]?.enabled ? g.fields.filter((f) => !excluded.has(f.key)).length : 0), 0)
  const groupsOn = property === PV ? drafts.filter((d) => d.enabled).length : fieldDrafts.filter((d) => d.enabled).length

  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <SheetPopup side="right" className="max-w-[680px] bg-(--surface-page)" showCloseButton={!busy}>
      <SheetHeader className="gap-0 border-b border-(--border-subtle) bg-(--surface-card) px-6 pt-5 pb-4 pr-14">
        <Steps step={step} />
        <SheetTitle className="mt-3.5 text-[20px] font-medium tracking-[-0.02em]">{busy ? 'Writing' : reviewing ? results.length ? 'Results' : 'Review' : 'Write to points'}</SheetTitle>
        <SheetDescription className="mt-0.5 text-[12.5px]">
          {targets.length} point{targets.length === 1 ? '' : 's'} · {loading ? 'reading live values…' : `${groupCount} group${groupCount === 1 ? '' : 's'} that take the same value the same way`}
        </SheetDescription>
        {!reviewing ? (
          <div className="mt-4 flex items-center gap-3">
            <span className="shrink-0 text-[12.5px] text-(--text-muted)">Property</span>
            <Select value={property} items={options} onValueChange={(v) => setProperty(String(v))}>
              <SelectTrigger aria-label="Property to write" disabled={loading} className="h-10 flex-1"><SelectValue /></SelectTrigger>
              <SelectPopup>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectPopup>
            </Select>
          </div>
        ) : null}
      </SheetHeader>
      <SheetPanel className="px-5 py-4">
        {error && <p role="alert" className="mb-3 rounded-[12px] bg-(--status-alarm-bg) px-3.5 py-2.5 text-[13px]">{error}</p>}
        {loading ? <Loading /> : reviewing ? <div className="flex flex-col gap-2">
          <p className="m-0 mb-1 px-1 text-[12.5px] leading-snug text-(--text-muted)">Each write is checked against the value reviewed here, sent, and read back. Stop halts the writes not yet sent; it does not undo the ones done. Every one goes to Activity.</p>
          <div className="overflow-hidden rounded-[14px] border border-(--border-subtle) bg-(--surface-card)">
            {(review ?? []).map(({ point, value, priority, release }) => (
              <ReviewRow key={point.key} name={point.name} sub={`Device ${point.device}`} result={results.find((r) => r.key === point.key)} sending={busy}
                from={valueLabel(point, point.current)} to={release ? `release P${priority}` : valueLabel(point, value)}
                note={priority ? `P${priority} · slot was ${point.slots?.[priority - 1] == null ? 'empty' : valueLabel(point, point.slots[priority - 1])}` : 'direct write'} />
            ))}
            {(fieldReview ?? []).map(({ field, shape, value }) => (
              <ReviewRow key={field.key} name={field.name} sub={`Device ${field.device}`} result={results.find((r) => r.key === field.key)} sending={busy}
                from={formatField(shape, field.current)} to={formatField(shape, value)} note={propertyLabel(field.property)} />
            ))}
          </div>
        </div> : property !== PV ? <div className="flex flex-col gap-2.5">
          <p className="m-0 px-1 text-[12.5px] leading-snug text-(--text-muted)">Switch on the groups to change. Each starts from its first point's value; points that already hold it are rewritten too.</p>
          {fieldGroups.map((g, index) => {
            const d = fieldDrafts[index]
            if (!d) return null
            const values = new Map<string, number>()
            for (const f of g.fields) values.set(formatField(g.shape, f.current), (values.get(formatField(g.shape, f.current)) ?? 0) + 1)
            const now = [...values.entries()].slice(0, 3).map(([v, n]) => (values.size > 1 ? `${v} (${n})` : v)).join(', ') + (values.size > 3 ? '…' : '')
            const setOn = (on: boolean) => setFieldDrafts((all) => all.map((x, i) => (i === index ? { ...x, enabled: on } : x)))
            return <Group key={index} on={d.enabled} onToggle={setOn} icon={<SlidersHorizontal />} names={g.fields.map((f) => f.name)}
              facts={[g.fields.length === 1 ? `Device ${g.fields[0].device}` : `${g.fields.length} points`, ...(g.shape.units ? [g.shape.units] : []), `now ${now}`]}
              points={g.fields.length === 1 ? null : <Targets items={g.fields.map((f) => ({ key: f.key, name: f.name, sub: `Device ${f.device}`, now: formatField(g.shape, f.current) }))} excluded={excluded} onInclude={include} />}>
              <Field label={`New ${propertyLabel(property).toLowerCase()}`}>
                <FieldEditor shape={g.shape} draft={d.value} label={`New ${propertyLabel(property).toLowerCase()} for group ${index + 1}`} onChange={(value) => setFieldDrafts((all) => all.map((x, i) => (i === index ? { ...x, value } : x)))} />
              </Field>
            </Group>
          })}
          {!fieldGroups.length && !failedPoints.length ? <p className="px-1 text-[13px] text-(--text-muted)">None of these points has {propertyLabel(property).toLowerCase()}.</p> : null}
        </div> : <div className="flex flex-col gap-2.5">
          <p className="m-0 px-1 text-[12.5px] leading-snug text-(--text-muted)">Switch on the groups to change. State labels map to each controller's own numbers, so one choice writes the right state everywhere.</p>
          {groups.map((group, index) => {
            const draft = drafts[index]
            if (!draft) return null
            const list = group.points, point = list[0]
            const units = group.units ? unitLabel(group.units) : ''
            const mixedUnits = [...new Set(list.map((p) => p.units))].filter((u) => u !== group.units)
            const values = new Set(list.map((p) => valueLabel(p, p.current)))
            const devicesIn = new Set(list.map((p) => p.device)).size
            const direct = list.filter((p) => !p.commandable).length
            const anyPriority = direct < list.length
            const choices = group.labels ? group.labels.map((label, i) => ({ value: i, label })) : []
            // what this draft does to each point, for the warnings under the value
            const planned = draft.enabled ? planGroup(group, draft) : { items: [] as Plan[] }
            const problems = planned.items.filter((x) => x.problem && !excluded.has(x.point.key))
            const skipped = planned.items.filter((x) => x.skip && !excluded.has(x.point.key))
            const facts = [
              list.length === 1 ? `Device ${point.device}` : `${list.length} points${devicesIn > 1 ? ` on ${devicesIn} devices` : ''}`,
              ...(units ? [mixedUnits.length ? `${units}, converted for ${mixedUnits.map(unitLabel).join(', ')}` : units] : []),
              ...(list.length === 1 && (point.minimum !== null || point.maximum !== null) ? [`limits ${point.minimum ?? '—'} to ${point.maximum ?? '—'}`] : []),
              !direct ? 'priority command' : direct === list.length ? 'direct write' : `${list.length - direct} by priority, ${direct} direct`,
              values.size === 1 ? `now ${[...values][0]}` : `${values.size} values now`,
              ...(point.kind !== 'analog' && !point.labelsComplete ? ['incomplete state labels'] : []),
            ]
            return <Group key={index} on={draft.enabled} onToggle={(on) => edit(index, { enabled: on })} icon={KIND_ICON[point.kind]} names={list.map((p) => p.name)}
              facts={facts} warn={point.kind !== 'analog' && !point.labelsComplete}
              points={list.length === 1 ? null : <Targets excluded={excluded} onInclude={include}
                items={list.map((p) => ({ key: p.key, name: p.name, now: valueLabel(p, p.current), sub: [`Device ${p.device}`, p.commandable ? '' : 'direct write', p.minimum !== null || p.maximum !== null ? `limits ${p.minimum ?? '—'} to ${p.maximum ?? '—'}` : '', p.slots?.some((v) => v !== null) ? p.slots.map((v, s) => (v === null ? null : `P${s + 1} ${valueLabel(p, v)}`)).filter(Boolean).join(', ') : ''].filter(Boolean).join(' · ') }))} />}>
              {anyPriority ? (
                <div className="flex items-end gap-2.5">
                  <Field label="Do" className="w-[220px] shrink-0">
                    <Toggle label={`Set or release group ${index + 1}`} value={draft.release ? 'release' : 'set'} onChange={(v) => edit(index, { release: v === 'release' })} options={[{ value: 'set', label: 'Set a value' }, { value: 'release', label: 'Release' }]} />
                  </Field>
                  <Field label={direct ? `At priority · ${direct} written directly` : 'At priority'} className="min-w-0 flex-1">
                    <Select value={draft.priority} items={PRIORITIES} onValueChange={(v) => edit(index, { priority: String(v) })}><SelectTrigger aria-label={`Priority for group ${index + 1}`}><SelectValue /></SelectTrigger><SelectPopup>{PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectPopup></Select>
                  </Field>
                </div>
              ) : null}
              {draft.release ? (
                <p className="m-0 rounded-[10px] bg-(--surface-track) px-3 py-2 text-[12.5px] leading-snug text-(--text-muted)">
                  Empties priority {draft.priority} on {list.length - direct === 1 ? 'this point' : `these ${list.length - direct} points`}. The next priority down, or the relinquish default, takes over.
                  {skipped.length ? ` ${skipped.length} written directly ${skipped.length === 1 ? 'has' : 'have'} no priority to release and ${skipped.length === 1 ? 'is' : 'are'} left as ${skipped.length === 1 ? 'it is' : 'they are'}.` : ''}
                </p>
              ) : point.kind === 'analog' ? (
                <div className="flex items-end gap-2.5">
                  {list.length > 1 ? (
                    <Field label="Value" className="w-[220px] shrink-0">
                      <Toggle label={`Set to or change by, group ${index + 1}`} value={draft.how} onChange={(v) => edit(index, { how: v, value: '' })} options={[{ value: 'set', label: 'Set to' }, { value: 'shift', label: 'Change by' }]} />
                    </Field>
                  ) : null}
                  <Field label={draft.how === 'shift' ? 'Change each by' : 'New value'} className="min-w-0 flex-1">
                    <NumberField size="lg" label={`Value for group ${index + 1}`} units={units}
                      placeholder={draft.how === 'shift' ? '+0.5 or -1' : values.size === 1 ? [...values][0].replace(units, '').trim() : 'New value'}
                      value={draft.value} onChange={(v) => edit(index, { value: v })} />
                  </Field>
                </div>
              ) : (
                <Field label="New state">
                  <FieldEditor shape={{ kind: 'enumerated', choices }} draft={draft.value === '' ? null : Number(draft.value)} onChange={(v) => edit(index, { value: String(v) })} label={`State for group ${index + 1}`} />
                  {list.some((p) => p.choices.some((c) => stateFor(point, c.label) !== c.value)) ? (
                    <span className="text-[11.5px] text-(--text-muted)">The controllers number these states differently; each gets its own number for the state you pick.</span>
                  ) : null}
                </Field>
              )}
              {draft.how === 'shift' && !draft.release && planned.items.length && !problems.length ? (
                <p className="m-0 text-[12px] text-(--text-muted)">
                  {planned.items.slice(0, 3).map((x) => `${x.point.name} ${valueLabel(x.point, x.point.current)} → ${valueLabel(x.point, x.value)}`).join(' · ')}
                  {planned.items.length > 3 ? ` · and ${planned.items.length - 3} more` : ''}
                </p>
              ) : null}
              {problems.length ? (
                <div className="flex items-start gap-3 rounded-[10px] bg-(--status-warn-bg) px-3 py-2 text-[12.5px] leading-snug">
                  <span className="min-w-0 flex-1">
                    {problems.length === 1 ? '1 point cannot take this' : `${problems.length} points cannot take this`}:{' '}
                    {problems.slice(0, 3).map((x) => `${x.point.name}, ${x.problem}`).join('; ')}
                    {problems.length > 3 ? `; and ${problems.length - 3} more` : ''}
                  </span>
                  <button type="button" className="shrink-0 font-medium hover:underline" onClick={() => problems.forEach((x) => include(x.point.key, false))}>
                    Leave {problems.length === 1 ? 'it' : 'them'} out
                  </button>
                </div>
              ) : null}
            </Group>
          })}
        </div>}
        {!loading && !reviewing && failedPoints.length ? <div className="mt-4 flex flex-col gap-1">
          <div className="px-1 pb-1 text-[12px] text-(--text-muted)">Left out · {failedPoints.length}</div>
          {failedPoints.map((p) => <div key={p.key} className="flex justify-between gap-3 rounded-[10px] bg-(--surface-card) px-3 py-2 text-[12px] shadow-[0_0_0_1px_var(--border-subtle)]"><span className="truncate">{rowOf.get(p.key)?.values['object-name'] || p.key}</span><span className="shrink-0 text-(--text-muted)">{p.error}</span></div>)}
        </div> : null}
      </SheetPanel>
      <SheetFooter className="items-center justify-between bg-(--surface-card) px-6 sm:justify-between">
        {busy ? <>
          <span role="status" className="flex items-center gap-3 text-[13px] tabular-nums">
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-(--surface-track)"><span className="block h-full rounded-full bg-(--ink) transition-[width] duration-300" style={{ width: `${total ? (100 * results.length) / total : 0}%` }} /></span>
            {results.length} / {total} done
          </span>
          <Button variant="outline" onClick={() => { cancel.current = true }}>Stop</Button>
        </> : results.length ? <>
          <span className="flex items-center gap-2 text-[13px]">
            <span className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[12px] font-medium tabular-nums text-(--ink)', verified === total ? 'bg-(--color-ns-green)' : 'bg-(--color-ns-yellow)')}>{verified} of {total} verified</span>
          </span>
          <span className="flex gap-2"><Button variant="outline" onClick={() => void load()}>Write something else</Button><Button onClick={onClose}>Done</Button></span>
        </> : reviewing ? <>
          <Button variant="ghost" onClick={() => { setReview(null); setFieldReview(null) }}>Back</Button>
          <Button onClick={() => void apply()}>Send {total} write{total === 1 ? '' : 's'}</Button>
        </> : <>
          <span className="flex items-center gap-3">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            {groupsOn ? <span className="text-[12.5px] tabular-nums text-(--text-muted)">{groupsOn} group{groupsOn === 1 ? '' : 's'} on · {pending} write{pending === 1 ? '' : 's'}</span> : null}
          </span>
          <Button disabled={loading || !groupCount} onClick={prepareReview}>Review</Button>
        </>}
      </SheetFooter>
    </SheetPopup>
  </Sheet>
}

const KIND_ICON: Record<ControlPoint['kind'], React.ReactNode> = { analog: <Activity />, binary: <ToggleLeft />, multistate: <List /> }

/** Choose → Review → Send: where the sheet is, done steps in lime. */
function Steps({ step }: { step: number }) {
  return (
    <ol className="m-0 flex list-none items-center gap-1.5 p-0 text-[12px]" aria-label="Steps">
      {['Choose', 'Review', 'Send'].map((label, i) => {
        const n = i + 1
        const state = n < step ? 'done' : n === step ? 'now' : 'next'
        return (
          <li key={label} className="flex items-center gap-1.5" aria-current={state === 'now' ? 'step' : undefined}>
            {i ? <span className={cn('h-px w-5', n <= step ? 'bg-(--ink)' : 'bg-(--border-default)')} /> : null}
            <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full pr-2.5 pl-1 transition-colors', state === 'now' ? 'bg-(--ink) text-white' : state === 'done' ? 'text-(--text-strong)' : 'text-(--text-faint)')}>
              <span className={cn('inline-flex size-4 items-center justify-center rounded-full text-[10.5px] font-medium tabular-nums', state === 'now' ? 'bg-(--color-ns-green) text-(--ink)' : state === 'done' ? 'bg-(--color-ns-green) text-(--ink)' : 'bg-(--surface-track)')}>
                {state === 'done' ? <Check className="size-2.5" strokeWidth={3} /> : n}
              </span>
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Loading() {
  return (
    <div role="status" className="flex flex-col gap-2.5">
      <p className="m-0 px-1 text-[12.5px] text-(--text-muted)">Reading values, state labels and priorities from the controllers.</p>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex h-[74px] items-center gap-3 rounded-[16px] bg-(--surface-card) px-4 shadow-[0_0_0_1px_var(--border-subtle)]">
          <Skeleton className="size-9 rounded-[10px]" />
          <span className="flex flex-1 flex-col gap-2"><Skeleton className="h-3.5 w-48 rounded-full" /><Skeleton className="h-3 w-64 rounded-full" /></span>
          <Skeleton className="h-5 w-9 rounded-full" />
        </div>
      ))}
    </div>
  )
}

/** A group by its points' names, each name once */
function groupTitle(group: WriteGroup) {
  return namesOf(group.points.map((p) => p.name))
}

/** "Heating valve", "Heating valve and Cooling valve", "Heating valve, Cooling valve and 3 more"; each name once */
function namesOf(all: string[]) {
  const names = [...new Set(all)]
  if (names.length <= 2) return names.join(' and ')
  return `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`
}

/** One group: named by its points, switched on from its header; the editor opens under it, the points sit at the foot. */
function Group({ on, onToggle, icon, names, facts, warn, points, children }: { on: boolean; onToggle: (on: boolean) => void; icon: React.ReactNode; names: string[]; facts: string[]; warn?: boolean; points: React.ReactNode; children: React.ReactNode }) {
  return (
    <section
      data-on={on ? 'true' : undefined}
      className="overflow-hidden rounded-[16px] bg-(--surface-card) shadow-[0_0_0_1px_var(--border-subtle),0_1px_2px_rgba(0,0,0,.03)] transition-shadow duration-200 data-[on=true]:shadow-[0_0_0_1.5px_var(--ink),0_8px_24px_-14px_rgba(0,0,0,.25)]"
    >
      <div className="flex cursor-pointer items-center gap-3 px-4 py-3.5 select-none" onClick={() => onToggle(!on)}>
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors duration-200 [&_svg]:size-[17px]', on ? 'bg-(--ink) text-(--color-ns-green)' : 'bg-(--surface-track) text-(--text-muted)')}>{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[14px] font-medium tracking-[-0.005em]" title={names.join(', ')}>{namesOf(names)}</span>
          <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-[12px] text-(--text-muted)">
            {facts.map((f, i) => (
              <span key={i} className={cn('whitespace-nowrap', warn && i === facts.length - 1 && 'text-(--status-warn-strong)')}>
                {i ? <span className="mr-1.5 text-(--ink-4)">·</span> : null}{f}
              </span>
            ))}
          </span>
        </span>
        <span onClick={(e) => e.stopPropagation()} className="flex">
          <Switch checked={on} onCheckedChange={(v) => onToggle(!!v)} aria-label={`Change ${namesOf(names)}`} className="data-checked:bg-(--ink)" />
        </span>
      </div>
      {on ? <div className="nc-view-in flex flex-col gap-3 border-t border-(--border-divider) px-4 pt-3.5 pb-4">{children}</div> : null}
      {points}
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="text-[11.5px] text-(--text-muted)">{label}</span>
      {children}
    </div>
  )
}

function Toggle<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid h-9 grid-cols-2 gap-1 rounded-[10px] bg-(--surface-track) p-[3px]">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={cn('min-w-0 truncate rounded-[8px] px-2 text-[12.5px] transition-colors', value === o.value ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-(--text-muted) hover:text-(--text-strong)')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ReviewRow({ name, sub, from, to, note, result, sending }: { name: string; sub: string; from: string; to: string; note: string; result?: Outcome; sending?: boolean }) {
  const tone = !result ? null : result.state === 'verified' ? 'ok' : result.state === 'rejected' ? 'bad' : 'warn'
  return <div className="border-b border-(--border-divider) px-4 py-3 last:border-b-0">
    <div className="flex items-center gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-[13.5px] font-medium">{name}</span>
        <span className="truncate text-[11.5px] text-(--text-muted)">{sub} · {note}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[13px] tabular-nums">
        <span className="text-(--text-muted)">{from}</span>
        <ArrowRight className="size-3.5 text-(--text-faint)" />
        <span className="rounded-full bg-(--color-ns-green-light) px-2.5 py-0.5 font-medium">{to}</span>
      </span>
      <span className="flex w-[78px] shrink-0 justify-end">
        {result ? (
          <span role="status" className={cn('inline-flex h-6 items-center rounded-full px-2.5 text-[11.5px] font-medium', tone === 'ok' ? 'bg-(--color-ns-green)' : tone === 'bad' ? 'bg-(--color-ns-red)' : 'bg-(--color-ns-yellow)')}>{result.state}</span>
        ) : sending ? <span className="text-[11.5px] text-(--text-faint)">waiting…</span> : null}
      </span>
    </div>
    {result && tone !== 'ok' ? <p className={cn('mt-2 mb-0 rounded-[8px] px-2.5 py-1.5 text-[12px]', tone === 'bad' ? 'bg-(--status-alarm-bg)' : 'bg-(--status-warn-bg)')}>{result.message}</p> : null}
  </div>
}

const SHOWN = 4

/** The group's points, each with its tick; past four they fold behind a button. */
function Targets({ items, excluded, onInclude }: { items: { key: string; name: string; sub: string; now: string }[]; excluded: Set<string>; onInclude: (key: string, on: boolean) => void }) {
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOWN)
  const included = items.filter((p) => !excluded.has(p.key)).length
  return <div className="border-t border-(--border-divider) bg-(--shell-sidebar) px-4 py-2">
    <div className="flex h-7 items-center justify-between text-[11.5px] text-(--text-muted)">
      <span>Points · <span className="tabular-nums">{included} of {items.length}</span> included</span>
      {items.length > 1 ? (
        <button type="button" className="hover:text-(--text-strong)" onClick={() => items.forEach((p) => onInclude(p.key, included < items.length))}>
          {included < items.length ? 'Include all' : 'Leave all out'}
        </button>
      ) : null}
    </div>
    {shown.map((p) => {
      const on = !excluded.has(p.key)
      return (
        <div key={p.key} className={cn('flex min-h-9 cursor-pointer items-center gap-3 rounded-[8px] py-1 transition-opacity', !on && 'opacity-55')} onClick={() => onInclude(p.key, !on)}>
          <Tick state={on} label={`Include ${p.name}`} onClick={() => onInclude(p.key, !on)} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[12.5px]">{p.name}</span>
            {p.sub ? <span className="truncate text-[11px] text-(--text-muted)" title={p.sub}>{p.sub}</span> : null}
          </span>
          <span className="shrink-0 text-[12.5px] tabular-nums text-(--text-muted)">{p.now}</span>
        </div>
      )
    })}
    {items.length > SHOWN ? (
      <button type="button" onClick={() => setAll(!all)} className="mt-0.5 flex h-7 items-center gap-1 text-[12px] font-medium text-(--text-muted) hover:text-(--text-strong)">
        <ChevronDown className={cn('size-3.5 transition-transform', all && 'rotate-180')} />
        {all ? 'Show fewer' : `Show all ${items.length}`}
      </button>
    ) : null}
  </div>
}
