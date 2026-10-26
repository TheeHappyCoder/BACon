import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type ControlField, type ControlPoint, type ControlResult, type FieldResult, type ObjectRow } from '../api'
import { propertyLabel } from '../actions'
import { PRIORITY_NAMES, WRITABLE_TYPES, groupPoints, valueLabel, unitLabel } from '../control'
import { INLINE_KINDS, draftOf, formatField, parseDraft, type FieldShape } from '../fields'
import { Button } from '../ui/components/button'
import { Checkbox } from '../ui/components/checkbox'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '../ui/components/sheet'
import { cn } from '../ui/utils'
import { useControl } from './ControlState'
import { FieldEditor } from './FieldEditor'

type Draft = { value: string; priority: string; release: boolean; enabled: boolean }
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
        setDrafts(groupPoints(next).map(() => ({ value: '', priority: '8', release: false, enabled: false })))
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
        const value = draft.release ? null : Number(draft.value)
        if (!draft.release && (!draft.value.trim() || !Number.isFinite(value))) throw new Error('Choose a value for each enabled group.')
        for (const point of group.filter((p) => !excluded.has(p.key))) {
          if (value !== null && ((point.minimum !== null && value < point.minimum) || (point.maximum !== null && value > point.maximum))) {
            throw new Error(`${point.name}: value exceeds controller limits. Adjust the value or exclude this point.`)
          }
          commands.push({ point, value, priority: point.commandable ? Number(draft.priority) : null, release: draft.release })
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

  return <Sheet open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
    <SheetPopup side="right" className="max-w-[640px]" showCloseButton={!busy}>
      <SheetHeader className="border-b border-(--border-subtle) px-5 py-5 pr-14">
        <SheetTitle>{busy ? 'Writing' : reviewing ? results.length ? 'Results' : 'Review' : 'Write to points'}</SheetTitle>
        <SheetDescription>{targets.length} point{targets.length === 1 ? '' : 's'} · {loading ? 'reading live values…' : `${groupCount} group${groupCount === 1 ? '' : 's'} that take the same value the same way`}</SheetDescription>
        {!reviewing ? (
          <label className="mt-3 flex items-center gap-3 text-[13px]">
            <span className="shrink-0 text-(--text-muted)">Write</span>
            <Select value={property} items={options} onValueChange={(v) => setProperty(String(v))}>
              <SelectTrigger aria-label="Property to write" disabled={loading}><SelectValue /></SelectTrigger>
              <SelectPopup>{options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectPopup>
            </Select>
          </label>
        ) : null}
      </SheetHeader>
      <SheetPanel className="px-5 py-4">
        {error && <p role="alert" className="mb-3 rounded-xl bg-(--status-alarm-bg) p-3 text-sm">{error}</p>}
        {loading ? <p role="status" className="text-sm text-(--text-muted)">Reading values, state labels and priorities from the controllers.</p> : reviewing ? <div className="space-y-2">
          <p className="m-0 mb-1 text-[13px] text-(--text-muted)">Each write is checked against the value reviewed here, sent, and read back. Stop halts the writes not yet sent; it does not undo the ones done. Every one goes to Activity.</p>
          {(review ?? []).map(({ point, value, priority, release }) => {
            const result = results.find((r) => r.key === point.key)
            return <ReviewRow key={point.key} name={point.name} sub={`Device ${point.device} · ${point.key}`} result={result}
              from={valueLabel(point, point.current)} to={release ? `Release priority ${priority}` : valueLabel(point, value)}
              note={priority ? `Priority ${priority} · slot was ${point.slots?.[priority - 1] == null ? 'empty' : valueLabel(point, point.slots[priority - 1])}` : 'Direct write'} />
          })}
          {(fieldReview ?? []).map(({ field, shape, value }) => {
            const result = results.find((r) => r.key === field.key)
            return <ReviewRow key={field.key} name={field.name} sub={`Device ${field.device} · ${field.key}`} result={result}
              from={formatField(shape, field.current)} to={formatField(shape, value)} note={propertyLabel(field.property)} />
          })}
        </div> : property !== PV ? <div className="space-y-3">
          <p className="m-0 text-[13px] text-(--text-muted)">Switch on the groups to change. Each starts from its first point's value; points that already hold it are rewritten too.</p>
          {fieldGroups.map((g, index) => {
            const d = fieldDrafts[index]
            if (!d) return null
            const included = g.fields.filter((f) => !excluded.has(f.key))
            const values = new Map<string, number>()
            for (const f of g.fields) values.set(formatField(g.shape, f.current), (values.get(formatField(g.shape, f.current)) ?? 0) + 1)
            return <section key={index} className={cn('rounded-2xl border p-4 transition-colors', d.enabled ? 'border-(--border-default) bg-(--surface-card)' : 'border-(--border-subtle) bg-(--surface-card-muted)')}>
              <label className="flex items-center gap-3 text-sm font-medium">
                <Checkbox checked={d.enabled} onCheckedChange={(v) => setFieldDrafts((all) => all.map((x, i) => (i === index ? { ...x, enabled: !!v } : x)))} />
                {g.fields.length} point{g.fields.length === 1 ? '' : 's'}{g.shape.units ? ` · ${g.shape.units}` : ''}
                <span className="font-normal text-(--text-muted)">· now {[...values.entries()].slice(0, 3).map(([v, n]) => (values.size > 1 ? `${v} (${n})` : v)).join(', ')}{values.size > 3 ? '…' : ''}</span>
              </label>
              {d.enabled ? <div className="mt-3"><FieldEditor shape={g.shape} draft={d.value} label={`New ${propertyLabel(property).toLowerCase()} for group ${index + 1}`} onChange={(value) => setFieldDrafts((all) => all.map((x, i) => (i === index ? { ...x, value } : x)))} /></div> : null}
              <Targets count={included.length} items={g.fields.map((f) => ({ key: f.key, name: f.name, sub: `Device ${f.device} · now ${formatField(g.shape, f.current)}` }))} excluded={excluded} onInclude={include} />
            </section>
          })}
          {!fieldGroups.length && !failedPoints.length ? <p className="text-sm text-(--text-muted)">None of these points has {propertyLabel(property).toLowerCase()}.</p> : null}
        </div> : <div className="space-y-3">
          <p className="m-0 text-[13px] text-(--text-muted)">Switch on the groups to change. State labels map to each controller's own numbers, so one choice writes the right state everywhere.</p>
          {groups.map((group, index) => {
            const point = group[0], draft = drafts[index]
            if (!draft) return null
            const choices = point.choices.map((c) => ({ value: String(c.value), label: c.label }))
            const included = group.filter((p) => !excluded.has(p.key))
            return <section key={index} className={cn('rounded-2xl border p-4 transition-colors', draft.enabled ? 'border-(--border-default) bg-(--surface-card)' : 'border-(--border-subtle) bg-(--surface-card-muted)')}>
              <label className="flex items-center gap-3 text-sm font-medium"><Checkbox checked={draft.enabled} onCheckedChange={(v) => edit(index, { enabled: !!v })} />{group.length} {point.kind} point{group.length === 1 ? '' : 's'}{point.units ? ` · ${unitLabel(point.units)}` : ''}
                <span className="font-normal text-(--text-muted)">· {point.commandable ? 'priority command' : 'direct write'}{!point.labelsComplete ? ' · incomplete state labels' : ''}</span></label>
              {draft.enabled ? <div className="mt-3 flex flex-col gap-2.5">
                {!draft.release && (point.kind === 'analog'
                  ? <label className="flex h-9 items-center gap-2 rounded-[10px] border border-(--border-default) bg-(--surface-input) px-3 focus-within:border-(--ring)"><Input unstyled nativeInput aria-label={`Value for group ${index + 1}`} type="number" step="any" className="h-full min-w-0 flex-1 text-[14px] tabular-nums" placeholder="New value" value={draft.value} onChange={(e) => edit(index, { value: e.target.value })} />{point.units ? <span className="text-[13px] text-(--text-muted)">{unitLabel(point.units)}</span> : null}</label>
                  : <FieldEditor shape={{ kind: 'enumerated', choices: point.choices }} draft={draft.value === '' ? null : Number(draft.value)} onChange={(v) => edit(index, { value: String(v) })} label={`State for group ${index + 1}`} />)}
                {point.commandable && <div className="flex items-center justify-between gap-3 text-[12.5px]">
                  <label className="flex items-center gap-2"><Checkbox checked={draft.release} onCheckedChange={(v) => edit(index, { release: !!v })} />Release instead of setting a value</label>
                  <Select value={draft.priority} items={PRIORITIES} onValueChange={(v) => edit(index, { priority: String(v) })}><SelectTrigger aria-label={`Priority for group ${index + 1}`} className="w-auto min-w-[190px]"><SelectValue /></SelectTrigger><SelectPopup>{PRIORITIES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectPopup></Select>
                </div>}
              </div> : null}
              <Targets count={included.length} excluded={excluded} onInclude={include}
                items={group.map((p) => ({ key: p.key, name: p.name, sub: `Device ${p.device} · now ${valueLabel(p, p.current)}${p.minimum !== null || p.maximum !== null ? ` · limits ${p.minimum ?? '—'} to ${p.maximum ?? '—'}` : ''}${choices.length && p.slots?.some((v) => v !== null) ? ` · ${p.slots.map((v, s) => (v === null ? null : `P${s + 1} ${valueLabel(p, v)}`)).filter(Boolean).join(', ')}` : ''}` }))} />
            </section>
          })}
        </div>}
        {!loading && !reviewing && failedPoints.length ? <div className="mt-3 space-y-1.5">
          <div className="text-[12px] text-(--text-muted)">Left out · {failedPoints.length}</div>
          {failedPoints.map((p) => <div key={p.key} className="flex justify-between gap-3 rounded-xl bg-(--surface-track) px-3 py-2 text-xs"><span className="truncate">{rowOf.get(p.key)?.values['object-name'] || p.key}</span><span className="shrink-0 text-(--text-muted)">{p.error}</span></div>)}
        </div> : null}
      </SheetPanel>
      <SheetFooter className="justify-between sm:justify-between">
        {busy ? <><span role="status" className="text-sm tabular-nums">{results.length} / {total} done</span><Button variant="outline" onClick={() => { cancel.current = true }}>Stop</Button></>
          : results.length ? <><span className="text-sm">{verified} of {total} verified</span><span className="flex gap-2"><Button variant="outline" onClick={() => void load()}>Write something else</Button><Button onClick={onClose}>Done</Button></span></>
          : reviewing ? <><Button variant="outline" onClick={() => { setReview(null); setFieldReview(null) }}>Back</Button><Button onClick={() => void apply()}>Send {total} write{total === 1 ? '' : 's'}</Button></>
          : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={loading || !groupCount} onClick={prepareReview}>Review</Button></>}
      </SheetFooter>
    </SheetPopup>
  </Sheet>
}

function ReviewRow({ name, sub, from, to, note, result }: { name: string; sub: string; from: string; to: string; note: string; result?: Outcome }) {
  return <div className="rounded-xl border border-(--border-subtle) px-3 py-2.5 text-sm">
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate font-medium">{name}</span>
      <span className="shrink-0 text-[11.5px] text-(--text-muted)">{note}</span>
    </div>
    <div className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-xs text-(--text-muted)">{sub}</span>
      <span className="shrink-0 tabular-nums">{from} <span className="text-(--text-faint)">→</span> <b className="font-medium">{to}</b></span>
    </div>
    {result && <p role="status" className={cn('mt-2 mb-0 rounded-lg px-2.5 py-1.5 text-[12px]', result.state === 'verified' ? 'bg-(--status-ok-bg)' : result.state === 'rejected' ? 'bg-(--status-alarm-bg)' : 'bg-(--status-warn-bg)')}>{result.message}</p>}
  </div>
}

function Targets({ count, items, excluded, onInclude }: { count: number; items: { key: string; name: string; sub: string }[]; excluded: Set<string>; onInclude: (key: string, on: boolean) => void }) {
  return <details className="mt-3 text-xs">
    <summary className="cursor-pointer text-(--text-muted)">Points · {count} of {items.length} included</summary>
    <div className="mt-2 space-y-2">{items.map((p) => <label key={p.key} className="flex items-start gap-2"><Checkbox checked={!excluded.has(p.key)} onCheckedChange={(v) => onInclude(p.key, !!v)} /><span className="min-w-0 break-words">{p.name}<span className="block text-(--text-muted)">{p.sub}</span></span></label>)}</div>
  </details>
}
