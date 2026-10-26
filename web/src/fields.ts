import type { FieldKind } from './api'

export type FieldShape = { kind: FieldKind; choices?: { value: number; label: string }[] | null; bits?: string[] | null; units?: string }
export type BDate = [number | null, number | null, number | null, number | null]

/** Kinds edited in place. Schedules and calendars have their own editor in Schedules. */
export const INLINE_KINDS = new Set<FieldKind>(['real', 'unsigned', 'integer', 'boolean', 'string', 'enumerated', 'bits', 'string-array', 'unsigned-array', 'atomic', 'date-range'])

const BIT_LABEL: Record<string, string> = {
  'to-offnormal': 'To alarm', 'to-fault': 'To fault', 'to-normal': 'To normal',
  'low-limit-enable': 'Low limit', 'high-limit-enable': 'High limit',
}
export const bitLabel = (b: string) => BIT_LABEL[b] ?? b.replace(/-/g, ' ')

const isoOf = (d: BDate | undefined) =>
  d && d[0] !== null && d[1] !== null && d[2] !== null && d[1] <= 12 && d[2] <= 31 ? `${d[0]}-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}` : ''

/** A property value in words, for the drawer, the review and the action log. */
export function formatField(shape: FieldShape, value: unknown): string {
  if (value === null || value === undefined) return '—'
  switch (shape.kind) {
    case 'real':
      return `${Number((value as number).toPrecision(7))}${shape.units ? ` ${shape.units}` : ''}`
    case 'boolean':
      return value ? 'True' : 'False'
    case 'enumerated':
      return shape.choices?.find((c) => c.value === value)?.label ?? String(value)
    case 'bits': {
      const on = (value as boolean[]).map((b, i) => (b ? bitLabel(shape.bits?.[i] ?? String(i)) : null)).filter(Boolean)
      return on.length ? on.join(', ') : 'None'
    }
    case 'string-array':
    case 'unsigned-array':
      return (value as unknown[]).join(' · ')
    case 'atomic': {
      const v = value as { type: string; value: unknown }
      return v.type === 'null' ? 'Null' : String(v.value)
    }
    case 'date-range': {
      const [a, b] = value as [BDate, BDate]
      return `${isoOf(a) || 'any'} → ${isoOf(b) || 'any'}`
    }
    case 'weekly':
      return `${(value as unknown[][]).reduce((n, d) => n + d.length, 0)} entries over the week`
    case 'exceptions':
      return `${(value as unknown[]).length} exception${(value as unknown[]).length === 1 ? '' : 's'}`
    case 'date-list':
      return `${(value as unknown[]).length} date${(value as unknown[]).length === 1 ? '' : 's'}`
    case 'string':
      return (value as string) || '(empty)'
    default:
      return String(value)
  }
}

/** The draft an editor starts from: the current value, with numbers as text so a person can type freely. */
export function draftOf(kind: FieldKind, current: unknown): unknown {
  if (kind === 'real' || kind === 'unsigned' || kind === 'integer') return current === null || current === undefined ? '' : String(current)
  if (kind === 'atomic') {
    const v = current as { type: string; value: unknown } | null
    return v ? { type: v.type, value: v.value === null ? '' : String(v.value) } : { type: 'real', value: '' }
  }
  return structuredClone(current)
}

/** The JSON value to send, or why the draft cannot be sent. */
export function parseDraft(shape: FieldShape, draft: unknown): { value: unknown } | { error: string } {
  const num = (s: unknown, whole: boolean, min?: number) => {
    const t = String(s ?? '').trim()
    if (!t) return { error: 'Enter a value' }
    const n = Number(t)
    if (!Number.isFinite(n)) return { error: 'Enter a number' }
    if (whole && !Number.isInteger(n)) return { error: 'Enter a whole number' }
    if (min !== undefined && n < min) return { error: `At least ${min}` }
    return { value: n }
  }
  switch (shape.kind) {
    case 'real':
      return num(draft, false)
    case 'unsigned':
      return num(draft, true, 0)
    case 'integer':
      return num(draft, true)
    case 'atomic': {
      const v = draft as { type: string; value: string }
      if (v.type === 'null') return { value: { type: 'null', value: null } }
      if (v.type === 'boolean') return { value: { type: 'boolean', value: v.value === 'true' } }
      if (v.type === 'string') return { value: { type: 'string', value: v.value } }
      const n = num(v.value, v.type !== 'real', v.type === 'unsigned' || v.type === 'enumerated' ? 0 : undefined)
      return 'error' in n ? n : { value: { type: v.type, value: n.value } }
    }
    case 'unsigned-array': {
      const out = []
      for (const x of draft as unknown[]) {
        const n = num(x, true, 0)
        if ('error' in n) return n
        out.push(n.value)
      }
      return { value: out }
    }
    case 'enumerated':
      return draft === null || draft === undefined ? { error: 'Choose one' } : { value: draft }
    default:
      return { value: draft }
  }
}
