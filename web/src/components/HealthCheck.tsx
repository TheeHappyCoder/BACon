import { useMemo, useState } from 'react'
import { api, type ObjectRow } from '../api'
import { evaluate, parse } from '../query'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { cn } from '../ui/utils'
import { useToast } from './Toasts'

const { ChevronRight, Check, FileSpreadsheet, Trash2 } = Hugeicons

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

const SEV: Record<Severity, { label: string; chip: string; dot: string }> = {
  critical: { label: 'critical', chip: 'bg-(--color-ns-red)', dot: 'bg-(--status-alarm-strong)' },
  high: { label: 'high', chip: 'bg-(--color-ns-yellow)', dot: 'bg-(--status-warn-strong)' },
  low: { label: 'low', chip: 'bg-(--color-ns-cyan-light)', dot: 'bg-(--status-info-strong)' },
}

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
  const [open, setOpen] = useState<Set<string>>(() => new Set(failing.slice(0, 1).map((c) => c.id)))
  const toggle = (id: string) =>
    setOpen((o) => {
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

  return (
    <div className="nc-view-in flex flex-col gap-3 px-[18px] pb-6">
      <div className="flex items-center gap-3 rounded-[14px] bg-(--surface-card-muted) px-4 py-3">
        <span className={cn('inline-flex size-9 shrink-0 items-center justify-center rounded-full', failing.length ? 'bg-(--color-ns-yellow)' : 'bg-(--color-ns-green)')}>
          {failing.length ? <span className="text-[14px] font-medium tabular-nums">{failing.length}</span> : <Check className="size-4" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium">
            {failing.length ? `${failing.length} of ${checks.length} checks need attention` : 'Everything passed'}
          </span>
          <span className="block truncate text-[12px] text-(--text-muted)">Checked {rows.length} objects in {scopeLabel}. Nothing was sent to the network.</span>
        </span>
        <Button size="sm" variant="white" onClick={exportReport}>
          <FileSpreadsheet />
          Export report
        </Button>
      </div>

      {failing.map((c) => {
        const isOpen = open.has(c.id)
        return (
          <div key={c.id} className="overflow-hidden rounded-[14px] border border-(--border-subtle)">
            <button onClick={() => toggle(c.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-(--surface-hover)">
              <ChevronRight className={cn('size-4 shrink-0 text-(--text-muted) transition-transform', isOpen && 'rotate-90')} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="text-[14px] font-medium">{c.title}</span>
                  <span className={cn('rounded-full px-2 py-px text-[11px] lowercase', SEV[c.severity].chip)}>{SEV[c.severity].label}</span>
                  {c.custom ? <span className="rounded-full bg-(--surface-track) px-2 py-px text-[11px] text-(--text-muted)">yours</span> : null}
                </span>
                <span className="mt-0.5 block text-[12.5px] text-(--text-muted)">{c.why}</span>
              </span>
              <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-(--surface-track) px-2 text-[12px] tabular-nums">{c.hits.length}</span>
            </button>
            {c.custom ? (
              <div className="flex justify-end border-t border-(--border-divider) px-3 py-1.5">
                <button className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) hover:text-(--text-strong)" onClick={() => onDeleteCheck(c.id)}>
                  <Trash2 className="size-3.5" />
                  Delete this check
                </button>
              </div>
            ) : null}
            {isOpen ? (
              <div className="border-t border-(--border-divider) px-2 py-1">
                {c.hits.slice(0, 500).map((h) => (
                  <button
                    key={h.row.key}
                    onClick={() => onSelect(h.row)}
                    data-selected={selectedKey === h.row.key ? 'true' : undefined}
                    className="flex w-full items-center gap-3 rounded-[9px] px-2 py-2 text-left transition-colors hover:bg-(--surface-hover) data-[selected=true]:bg-(--paper-3)"
                  >
                    <span className={cn('size-1.5 shrink-0 rounded-full', SEV[c.severity].dot)} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{h.row.values['object-name'] || 'Unnamed'}</span>
                      <span className="mt-0.5 flex items-center gap-1">
                        <span className="rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">{h.row.values['Object type']}</span>
                        <span className="rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">#{h.row.instance}</span>
                        <span className="truncate rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">{h.row.values['Device name'] || h.row.device}</span>
                      </span>
                    </span>
                    <span className="max-w-[45%] shrink-0 truncate text-right text-[12.5px] text-(--text-muted)" title={h.detail}>
                      {h.detail}
                    </span>
                  </button>
                ))}
                {c.hits.length > 500 ? <div className="px-2 py-2 text-[12px] text-(--text-muted)">The first 500 are shown. The report has all {c.hits.length}.</div> : null}
              </div>
            ) : null}
          </div>
        )
      })}

      {passed.length ? (
        <div className="rounded-[14px] border border-(--border-subtle) px-4 py-3">
          <div className="mb-2 text-[12px] text-(--text-muted)">Passed</div>
          <div className="flex flex-wrap gap-1.5">
            {passed.map((c) => (
              <span
                key={c.id}
                title={c.skipped ? 'This site does not have the properties this check uses.' : c.custom ? c.why : undefined}
                className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]', c.skipped ? 'bg-(--surface-track) text-(--text-muted)' : 'bg-(--status-ok-bg)')}
              >
                {c.skipped ? null : <Check className="size-3" />}
                {c.title}
                {c.skipped ? ' · not on this site' : ''}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
