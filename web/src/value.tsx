import { memo, type ReactNode } from 'react'
import type { ObjectRow } from './api'
import { unitLabel } from './control'
import { valueMarkers } from './triage'
import { Tooltip, TooltipPopup, TooltipTrigger } from './ui/components/tooltip'
import { cn } from './ui/utils'

const BINARY = new Set([3, 4, 5])
const MULTISTATE = new Set([13, 14, 19])

export type Formatted = {
  text: string
  number: number | null
  kind: 'missing' | 'error' | 'binary' | 'state' | 'number' | 'text'
  state?: 'active' | 'inactive'
  raw: string
  unit?: string
}

/** The present value as the building reads it: the state's own words, a number with its unit. Exports stay raw. */
export function formatValue(row: ObjectRow): Formatted {
  const raw = row.values['present-value']
  if (raw === undefined) {
    const error = row.errors['present-value']
    return error !== undefined ? { text: error, number: null, kind: 'error', raw: '' } : { text: '', number: null, kind: 'missing', raw: '' }
  }
  if (BINARY.has(row.typeId)) {
    if (raw === 'active') return { text: row.values['active-text'] || 'Active', number: null, kind: 'binary', state: 'active', raw }
    if (raw === 'inactive') return { text: row.values['inactive-text'] || 'Inactive', number: null, kind: 'binary', state: 'inactive', raw }
    return { text: raw, number: null, kind: 'text', raw }
  }
  const states = row.values['state-text']
  if (MULTISTATE.has(row.typeId) && states !== undefined && /^\d+$/.test(raw.trim()) && Number(raw) >= 1) {
    const n = Number(raw)
    return { text: states.split('; ')[n - 1] || `State ${n}`, number: n, kind: 'state', raw }
  }
  const v = raw.trim() === '' ? NaN : Number(raw)
  if (Number.isFinite(v)) {
    const units = row.values.units
    return { text: String(Number(v.toFixed(2))), number: v, kind: 'number', raw, unit: units && units !== 'no-units' ? unitLabel(units) : undefined }
  }
  return { text: raw, number: null, kind: 'text', raw }
}

export function ErrorPill({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex max-w-full items-center rounded-full bg-(--status-alarm-bg) px-2 py-px text-[11.5px]" />}>
        <span className="truncate">unreadable</span>
      </TooltipTrigger>
      <TooltipPopup>{text}</TooltipPopup>
    </Tooltip>
  )
}

function Marker({ className, title, children }: { className: string; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={cn('ml-1.5 inline-flex h-[18px] shrink-0 items-center rounded-full px-1.5 text-[10.5px] leading-none text-(--text-strong)', className)}>
      {children}
    </span>
  )
}

/** One line, right-aligned: the value, then what the object says about itself (fault, alarm, overrides, who holds it). */
export const ValueCell = memo(function ValueCell({ row, held }: { row: ObjectRow; held?: { priority: number | null }[] }) {
  const f = formatValue(row)
  return (
    <span className="flex min-w-0 items-center justify-end text-right text-[12.5px] whitespace-nowrap tabular-nums">
      {f.kind === 'missing' ? (
        <span className="text-(--ink-4)" title="This object does not have a present value">–</span>
      ) : f.kind === 'error' ? (
        <ErrorPill text={f.text} />
      ) : f.kind === 'binary' ? (
        <span className="flex min-w-0 items-center gap-1.5" title={f.raw}>
          <span className={cn('size-1.5 shrink-0 rounded-full', f.state === 'active' ? 'bg-(--status-ok-strong)' : 'bg-(--ink-4)')} />
          <span className="truncate">{f.text}</span>
        </span>
      ) : f.kind === 'state' ? (
        <span className="min-w-0 truncate" title={f.text}>
          {f.text}
          <span className="ml-1 text-(--text-faint)">{f.number}</span>
        </span>
      ) : f.kind === 'number' ? (
        <span className="min-w-0 truncate" title={f.raw !== f.text ? f.raw : undefined}>
          {f.text}
          {f.unit ? <span className="ml-1 text-(--text-muted)">{f.unit}</span> : null}
        </span>
      ) : (
        <span className="min-w-0 truncate" title={f.text}>
          {f.text}
        </span>
      )}
      {valueMarkers(row, held).map((m) => (
        <Marker key={m.label} className={m.className} title={m.title}>
          {m.label}
        </Marker>
      ))}
    </span>
  )
})
