import { useMemo, useState } from 'react'
import { api, type ObjectRow } from '../api'
import { evaluate, parse } from '../query'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { cn } from '../ui/utils'
import { useToast } from './Toasts'

const { ChevronDown, Check, FileSpreadsheet, Trash2, AlertTriangle, XIcon } = Hugeicons

type Severity = 'critical' | 'high' | 'low'
type Hit = { row: ObjectRow; detail: string }
export type CheckResult = { id: string; title: string; why: string; severity: Severity; hits: Hit[]; custom?: boolean; skipped?: boolean }
export type SavedCheck = { id: string; name: string; severity: Severity; query: string }

const POINT = /^(analog|binary|multi-state)-(input|output|value)$|^accumulator$|^pulse-converter$|^(integer|positive-integer|large-analog)-value$/
const COMMANDABLE = /^(analog|binary|multi-state)-(output|value)$/

const has = (r: ObjectRow, p: string) => r.values[p] !== undefined
const v = (r: ObjectRow, p: string) => (r.values[p] ?? '').trim()
const isPoint = (r: ObjectRow) => POINT.test(r.values['Object type'])

/** Priorities 1-8 are life safety, critical equipment, minimum on/off and manual operator. */
function highPriorityCommand(pa: string): string | null {
  const slots = pa.split(';').map((s) => s.trim())
  if (slots.length !== 16) return null
  for (let i = 0; i < 8; i++) if (slots[i] && slots[i] !== 'null') return `priority ${i + 1} = ${slots[i]}`
  return null
}

/** Every rule only looks at objects that actually have the property, so nothing is flagged for being unsupported. */
export function runChecks(rows: ObjectRow[], saved: SavedCheck[] = []): CheckResult[] {
  const out: CheckResult[] = []
  const add = (id: string, title: string, why: string, severity: Severity, hits: Hit[]) => out.push({ id, title, why, severity, hits })

  add('read', 'Could not be read', 'Some or all of these objects did not answer, so their data is incomplete.', 'critical',
    rows.filter((r) => r.status !== 'ok').map((r) => ({ row: r, detail: r.values['Read status'] })))

  add('fault', 'Fault or unreliable', 'The controller does not trust this value: a broken sensor, open circuit, or config fault.', 'critical',
    rows.filter((r) => (has(r, 'reliability') && v(r, 'reliability') !== 'no-fault-detected') || v(r, 'status-flags').includes('fault'))
      .map((r) => ({ row: r, detail: v(r, 'reliability') || v(r, 'status-flags') })))

  add('override', 'Commanded at a high priority', 'Held at priority 1 to 8, usually a manual override someone forgot to release.', 'high',
    rows.filter((r) => COMMANDABLE.test(r.values['Object type']) && has(r, 'priority-array') && highPriorityCommand(v(r, 'priority-array')))
      .map((r) => ({ row: r, detail: highPriorityCommand(v(r, 'priority-array')) ?? '' })))

  add('overridden', 'Overridden locally', 'The overridden flag is set: a hand switch or local panel has taken control.', 'high',
    rows.filter((r) => v(r, 'status-flags').includes('overridden')).map((r) => ({ row: r, detail: v(r, 'status-flags') })))

  add('oos', 'Out of service', 'The value is frozen and not following the field. Fine while commissioning, not at handover.', 'high',
    rows.filter((r) => v(r, 'out-of-service') === 'true' || v(r, 'out-of-service') === '1').map((r) => ({ row: r, detail: 'out-of-service = true' })))

  add('alarm', 'In alarm', 'Currently in an alarm or fault event state.', 'high',
    rows.filter((r) => isPoint(r) && ((has(r, 'event-state') && v(r, 'event-state') !== 'normal' && v(r, 'event-state') !== '0') || v(r, 'status-flags').includes('in-alarm')))
      .map((r) => ({ row: r, detail: v(r, 'event-state') || v(r, 'status-flags') })))

  const dupes: Hit[] = []
  const byDevice = new Map<number, Map<string, ObjectRow[]>>()
  for (const r of rows) {
    const name = v(r, 'object-name')
    if (!name) continue
    const m = byDevice.get(r.device) ?? new Map<string, ObjectRow[]>()
    m.set(name, [...(m.get(name) ?? []), r])
    byDevice.set(r.device, m)
  }
  for (const m of byDevice.values()) for (const [name, list] of m) if (list.length > 1) for (const r of list) dupes.push({ row: r, detail: `${list.length} objects named ${name}` })
  add('dupes', 'Duplicate names', 'Object names must be unique in a device. Duplicates break graphics, trends, and integrations.', 'high', dupes)

  add('nodesc', 'No description', 'Points without a description are hard to identify in a points list or at handover.', 'low',
    rows.filter((r) => isPoint(r) && !v(r, 'description')).map((r) => ({ row: r, detail: 'description is empty' })))

  add('nounits', 'No engineering units', 'Analog points without units show bare numbers on graphics and trends.', 'low',
    rows.filter((r) => /^analog-/.test(r.values['Object type']) && (!has(r, 'units') || v(r, 'units') === 'no-units'))
      .map((r) => ({ row: r, detail: v(r, 'units') || 'units missing' })))

  add('noalarms', 'Alarm reporting off', 'Alarm limits are configured but no alarm transitions are reported.', 'low',
    rows.filter((r) => has(r, 'event-enable') && v(r, 'event-enable') === 'none' && (has(r, 'high-limit') || has(r, 'alarm-value') || has(r, 'alarm-values')))
      .map((r) => ({ row: r, detail: 'event-enable = none' })))

  // your own checks: saved filters, run on whatever is in view
  const props = [...new Set(rows.flatMap((r) => [...Object.keys(r.values), ...Object.keys(r.errors)]))]
  for (const c of saved) {
    let node = null
    try {
      node = parse(c.query, props)
    } catch {
      out.push({ id: c.id, title: c.name, why: c.query, severity: c.severity, hits: [], custom: true, skipped: true })
      continue
    }
    const hits = node ? rows.filter((r) => evaluate(node, r)).map((r) => ({ row: r, detail: c.query })) : []
    out.push({ id: c.id, title: c.name, why: c.query, severity: c.severity, hits, custom: true })
  }
  return out
}

const SEV: Record<Severity, { label: string; chip: string; dot: string; tile: string }> = {
  critical: { label: 'critical', chip: 'bg-(--color-ns-red)', dot: 'bg-(--status-alarm-strong)', tile: 'bg-(--color-ns-red) text-(--ink)' },
  high: { label: 'high', chip: 'bg-(--color-ns-yellow)', dot: 'bg-(--status-warn-strong)', tile: 'bg-(--color-ns-yellow) text-(--ink)' },
  low: { label: 'low', chip: 'bg-(--color-ns-cyan-light)', dot: 'bg-(--status-info-strong)', tile: 'bg-(--color-ns-cyan-light) text-(--ink)' },
}
/** The Flagged tile takes the colour of the worst check flagged. */
const TILE: Record<Severity, string> = { critical: 'bg-(--color-ns-red-light)', high: 'bg-(--color-ns-yellow-light)', low: 'bg-(--color-ns-cyan-light)' }

export function HealthCheck({
  rows,
  selectedKey,
  onSelect,
  scopeLabel,
  saved,
  onDeleteCheck,
}: {
  saved: SavedCheck[]
  onDeleteCheck: (id: string) => void
  rows: ObjectRow[]
  selectedKey: string | null
  onSelect: (row: ObjectRow) => void
  scopeLabel: string
}) {
  const toast = useToast()
  const checks = useMemo(() => runChecks(rows, saved), [rows, saved])
  const failing = checks.filter((c) => c.hits.length)
  const passed = checks.filter((c) => !c.hits.length)
  // every flagged check is open until you fold it; one that starts failing later opens too
  const [closed, setClosed] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) =>
    setClosed((o) => {
      const n = new Set(o)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const exportReport = async () => {
    try {
      const columns = ['Severity', 'Device', 'Device name', 'Object type', 'Instance', 'object-name', 'Issue']
      const toRow = (c: CheckResult, h: Hit) => [c.severity, String(h.row.device), h.row.values['Device name'] ?? '', h.row.values['Object type'], String(h.row.instance), h.row.values['object-name'] ?? '', h.detail]
      const sheets = [
        { name: 'Summary', columns: ['Check', 'Severity', 'Objects', 'Why it matters'], rows: checks.map((c) => [c.title, c.severity, String(c.hits.length), c.why]) },
        ...failing.map((c) => ({ name: c.title, columns, rows: c.hits.map((h) => toRow(c, h)) })),
      ]
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      const filename = `bacnet-health-check-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.xlsx`
      const blob = await api.exportXlsx(filename, sheets)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast(`Saved the health check to ${filename}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  if (!rows.length) return null

  const RANK: Record<Severity, number> = { critical: 0, high: 1, low: 2 }
  const ordered = [...failing].sort((a, b) => RANK[a.severity] - RANK[b.severity])
  const worst = ordered[0]?.severity
  const showDevice = new Set(rows.map((r) => r.device)).size > 1
  const GRID = showDevice ? 'grid-cols-[minmax(220px,1.4fr)_150px_56px_minmax(120px,0.8fr)_minmax(180px,1.3fr)]' : 'grid-cols-[minmax(220px,1.4fr)_150px_56px_minmax(180px,1.5fr)]'

  return (
    <div className="nc-view-in flex flex-col gap-5 px-6 pt-5 pb-8">
      {/* the score: what BACon flagged, what passed */}
      <div className="flex items-stretch gap-3">
        <div className={cn('flex min-w-0 flex-1 items-center gap-4 rounded-[16px] px-5 py-4', failing.length ? TILE[worst!] : 'bg-(--surface-card-muted)')}>
          <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-[12px] [&_svg]:size-5', failing.length ? 'bg-(--ink) text-white' : 'bg-(--surface-card) text-(--text-faint)')}>
            <AlertTriangle />
          </span>
          <span className="flex flex-col">
            <span className="text-[30px] leading-8 font-medium tracking-[-0.02em] tabular-nums">{failing.length}</span>
            <span className="text-[12.5px]">{failing.length === 1 ? 'check flagged' : 'checks flagged'}</span>
          </span>
        </div>
        <div className="flex min-w-0 flex-1 items-center gap-4 rounded-[16px] bg-(--color-ns-green-light) px-5 py-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-(--ink) text-(--color-ns-green) [&_svg]:size-5">
            <Check />
          </span>
          <span className="flex flex-col">
            <span className="text-[30px] leading-8 font-medium tracking-[-0.02em] tabular-nums">{passed.length}</span>
            <span className="text-[12.5px]">{passed.length === 1 ? 'check passed' : 'checks passed'}</span>
          </span>
        </div>
        <div className="flex shrink-0 flex-col items-end justify-center gap-1.5 pl-2">
          <Button size="sm" variant="secondary" onClick={exportReport}>
            <FileSpreadsheet />
            Export report
          </Button>
          <span className="text-[11.5px] text-(--text-faint)">From the last read of {scopeLabel}</span>
        </div>
      </div>

      {/* the checklist: flagged first, worst first, then what passed */}
      <div className="overflow-hidden rounded-[16px] bg-(--surface-card) shadow-[0_0_0_1px_var(--border-subtle)]">
        {ordered.length ? <ListHead tone="flagged" label="Flagged" count={ordered.length} /> : null}
        {ordered.map((c) => {
          const isOpen = !closed.has(c.id)
          return (
            <section key={c.id} className="border-b border-(--border-divider) last:border-b-0">
              <button onClick={() => toggle(c.id)} aria-expanded={isOpen} className="flex w-full items-center gap-3.5 px-4 py-3 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_2.5%,transparent)]">
                <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-4', SEV[c.severity].tile)}>
                  <XIcon />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium">{c.title}</span>
                    <span className={cn('rounded-full px-2 py-px text-[11px] lowercase', SEV[c.severity].chip)}>{SEV[c.severity].label}</span>
                    {c.custom ? <span className="rounded-full bg-(--surface-track) px-2 py-px text-[11px] text-(--text-muted)">yours</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-(--text-muted)">{c.why}</span>
                </span>
                <span className="shrink-0 rounded-full bg-(--ink) px-2.5 py-0.5 text-[12px] font-medium text-white tabular-nums">
                  {c.hits.length} {c.hits.length === 1 ? 'object' : 'objects'}
                </span>
                <ChevronDown className={cn('size-4 shrink-0 text-(--text-muted) transition-transform duration-200', !isOpen && '-rotate-90')} />
              </button>
              {isOpen ? (
                <div className="mx-4 mb-3 overflow-hidden rounded-[12px] border border-(--border-subtle)">
                  <div className={cn('grid h-8 items-center gap-4 bg-(--surface-card-muted) px-4 text-[11.5px] text-(--text-muted)', GRID)}>
                    <span>Object</span>
                    <span>Type</span>
                    <span className="text-right">#</span>
                    {showDevice ? <span>Device</span> : null}
                    <span>Issue</span>
                  </div>
                  {c.hits.slice(0, 500).map((h) => {
                    const on = selectedKey === h.row.key
                    return (
                      <button
                        key={h.row.key}
                        onClick={() => onSelect(h.row)}
                        className={cn(
                          'relative grid min-h-10 w-full items-center gap-4 border-t border-(--border-divider) px-4 py-1.5 text-left text-[12.5px] transition-colors',
                          on ? 'bg-(--surface-selected)' : 'hover:bg-[color-mix(in_srgb,var(--ink)_2.5%,transparent)]',
                          GRID,
                        )}
                      >
                        {on ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-(--ink)" /> : null}
                        <span className="truncate text-[13px] font-medium">{h.row.values['object-name'] || 'Unnamed'}</span>
                        <span className="truncate text-[12px] text-(--text-muted)">{h.row.values['Object type']}</span>
                        <span className="text-right text-[12px] tabular-nums text-(--text-muted)">{h.row.instance}</span>
                        {showDevice ? <span className="truncate text-[12px] text-(--text-muted)">{h.row.values['Device name'] || h.row.device}</span> : null}
                        <span className="truncate" title={h.detail}>
                          {h.detail}
                        </span>
                      </button>
                    )
                  })}
                  {c.hits.length > 500 ? <div className="border-t border-(--border-divider) px-4 py-2.5 text-[12px] text-(--text-muted)">The first 500 are shown. The report has them all.</div> : null}
                  {c.custom ? (
                    <div className="flex justify-end border-t border-(--border-divider) px-4 py-1.5">
                      <button className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) hover:text-(--text-strong)" onClick={() => onDeleteCheck(c.id)}>
                        <Trash2 className="size-3.5" />
                        Delete this check
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>
          )
        })}

        {passed.length ? <ListHead tone="passed" label="Passed" count={passed.length} /> : null}
        {passed.map((c) => (
          <div key={c.id} className="flex items-center gap-3.5 border-b border-(--border-divider) px-4 py-3 last:border-b-0">
            <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-4', c.skipped ? 'bg-(--surface-track) text-(--text-faint)' : 'bg-(--color-ns-green-light) text-(--status-ok-strong)')}>
              <Check />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className={cn('text-[13.5px]', c.skipped ? 'text-(--text-muted)' : 'font-medium')}>{c.title}</span>
                {c.custom ? <span className="rounded-full bg-(--surface-track) px-2 py-px text-[11px] text-(--text-muted)">yours</span> : null}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-(--text-muted)">{c.skipped ? 'This site does not have the properties this check uses.' : c.why}</span>
            </span>
            <span className={cn('shrink-0 text-[12px] font-medium', c.skipped ? 'text-(--text-faint)' : 'text-(--status-ok-strong)')}>{c.skipped ? 'Not on this site' : 'Passed'}</span>
            {c.custom ? (
              <button aria-label={`Delete ${c.title}`} title="Delete this check" className="inline-flex size-7 items-center justify-center rounded-full text-(--text-faint) hover:bg-(--surface-track) hover:text-(--text-strong)" onClick={() => onDeleteCheck(c.id)}>
                <Trash2 className="size-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/** A heading inside the checklist: Flagged or Passed, with how many. */
function ListHead({ tone, label, count }: { tone: 'flagged' | 'passed'; label: string; count: number }) {
  return (
    <div className="flex h-9 items-center gap-2 border-b border-(--border-subtle) bg-(--surface-card-muted) px-4 text-[11.5px] font-medium tracking-[0.02em] text-(--text-muted) uppercase">
      <span className={cn('size-1.5 rounded-full', tone === 'flagged' ? 'bg-(--status-alarm-strong)' : 'bg-(--status-ok-strong)')} />
      {label}
      <span className="font-normal text-(--text-faint) tabular-nums">{count}</span>
    </div>
  )
}
