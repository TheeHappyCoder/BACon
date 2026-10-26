import { useState } from 'react'
import { api, type ControlField, type FieldResult, type FieldSpec, type ObjectRow } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { cn } from '../ui/utils'
import { useControl } from './ControlState'
import { bitLabel, draftOf, formatField, parseDraft, type FieldShape } from '../fields'
import { FieldEditor } from './FieldEditor'

const { CheckIcon, PencilEdit } = Hugeicons
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * One writable property in the drawer. At rest it shows what the last read said. Edit reads it live, Review shows
 * before and after, Send writes it and reads it back; the result stays under the row until the next edit.
 */
export function PropertyWrite({ row, property, label, spec, shapeOf, canWrite, onWritten }: {
  row: ObjectRow
  property: string
  label: string
  spec: FieldSpec
  /** refine the editor once the live value is known (state labels for a multistate default, units) */
  shapeOf?: (field: ControlField) => FieldShape
  canWrite: boolean
  onWritten: () => void
}) {
  const control = useControl()
  const [field, setField] = useState<ControlField | null>(null)
  const [draft, setDraft] = useState<unknown>(null)
  const [stage, setStage] = useState<'view' | 'loading' | 'edit' | 'confirm' | 'sending'>('view')
  const [result, setResult] = useState<FieldResult | { state: 'error'; message: string } | null>(null)

  const choices = spec.enum ? control.writable?.enums[spec.enum] : undefined
  const shape: FieldShape = field ? shapeOf?.(field) ?? { kind: field.kind, choices: field.choices, bits: field.bits } : { kind: spec.kind, choices, bits: spec.bits }
  const parsed = stage === 'edit' || stage === 'confirm' || stage === 'sending' ? parseDraft(shape, draft) : null
  // after a write, what the controller read back, until the next read of the object catches up
  const readBack = result && 'current' in result && result.current !== undefined ? formatField(shape, result.current) : null
  const raw = row.values[property]
  // the last read, in words: bit names and true/false as the editor shows them
  const rest = raw === undefined ? '—' : spec.kind === 'bits' ? raw.split(';').filter(Boolean).map(bitLabel).join(', ') || 'None' : spec.kind === 'boolean' ? (raw === 'true' ? 'True' : raw === 'false' ? 'False' : raw) : raw
  const shown = readBack ?? (row.errors[property] !== undefined ? 'unreadable' : rest)
  const verified = result?.state === 'verified'

  async function edit() {
    setStage('loading')
    setResult(null)
    try {
      const [next] = await api.fieldPrepare([row], property)
      if (!next || next.error) throw new Error(next?.error || 'Could not read the property.')
      setField(next)
      setDraft(draftOf(next.kind, next.current))
      setStage('edit')
    } catch (e) {
      setResult({ state: 'error', message: message(e) })
      setStage('view')
    }
  }

  async function send() {
    if (!field || !parsed || !('value' in parsed)) return
    setStage('sending')
    try {
      setResult(await api.fieldWrite(field.token, parsed.value))
    } catch (e) {
      setResult({ state: 'error', message: message(e) })
    } finally {
      setStage('view') // the field stays, spent, so the read-back is shown in its own terms
      control.refresh()
      onWritten()
    }
  }

  return (
    <div className={cn('rounded-[10px] transition-colors', stage !== 'view' && stage !== 'loading' && 'bg-(--surface-card-muted) p-2.5')}>
      <div className={cn('group/prop flex min-h-8 items-center justify-between gap-3 text-[12.5px]', stage === 'view' || stage === 'loading' ? 'px-2' : '')}>
        <span className="shrink-0 text-(--text-muted)">{label}</span>
        <span className="flex min-w-0 items-center gap-1">
          {verified && stage === 'view' ? (
            <span role="status" title={result.message} className="inline-flex shrink-0 items-center gap-1 text-[11px] text-(--status-ok-strong)">
              <CheckIcon className="size-3" />
              verified
            </span>
          ) : null}
          {stage === 'view' || stage === 'loading' ? <span className="min-w-0 truncate text-right tabular-nums" title={shown}>{shown}</span> : null}
          {stage === 'view' || stage === 'loading' ? (
            <Button aria-label={`Edit ${label}`} variant="ghost" size="icon-xs" className="size-6 shrink-0 opacity-60 group-hover/prop:opacity-100" loading={stage === 'loading'} disabled={!canWrite} onClick={() => void edit()}>
              <PencilEdit className="size-3.5" />
            </Button>
          ) : null}
        </span>
      </div>

      {field && stage === 'edit' ? (
        <div className="mt-2 flex flex-col gap-2">
          <FieldEditor shape={shape} draft={draft} onChange={setDraft} label={label} />
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] text-(--text-faint)">Now {formatField(shape, field.current)}</span>
            <span className="flex gap-1.5">
              <Button size="xs" variant="ghost" onClick={() => { setStage('view'); setField(null) }}>Cancel</Button>
              <Button size="xs" disabled={!parsed || !('value' in parsed)} title={parsed && 'error' in parsed ? parsed.error : undefined} onClick={() => setStage('confirm')}>Review</Button>
            </span>
          </div>
        </div>
      ) : null}

      {field && parsed && 'value' in parsed && (stage === 'confirm' || stage === 'sending') ? (
        <div className="mt-2 flex flex-col gap-2 rounded-[10px] bg-(--surface-checked) px-3 py-2.5">
          <div className="text-[12.5px] leading-snug">
            Change <b className="font-medium">{label.toLowerCase()}</b> on <b className="font-medium">{field.name}</b>
            <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-[12px]">
              <span className="text-(--text-muted)">from</span><span className="min-w-0 break-words tabular-nums">{formatField(shape, field.current)}</span>
              <span className="text-(--text-muted)">to</span><span className="min-w-0 break-words font-medium tabular-nums">{formatField(shape, parsed.value)}</span>
            </div>
          </div>
          <div className="flex justify-end gap-1.5">
            <Button size="xs" variant="ghost" disabled={stage === 'sending'} onClick={() => setStage('edit')}>Back</Button>
            <Button size="xs" loading={stage === 'sending'} onClick={() => void send()}>Send</Button>
          </div>
        </div>
      ) : null}

      {result && !verified && stage === 'view' ? (
        <p role="status" className={cn('m-0 mx-2 mb-1 rounded-[9px] px-2.5 py-1.5 text-[11.5px] leading-snug',
          result.state === 'rejected' || result.state === 'error' ? 'bg-(--status-alarm-bg)' : 'bg-(--status-warn-bg)')}>
          {result.message}
        </p>
      ) : null}
    </div>
  )
}
