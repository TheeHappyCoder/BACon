import { bitLabel, type BDate, type FieldShape } from '../fields'
import { Checkbox } from '../ui/components/checkbox'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { cn } from '../ui/utils'
import { DateField } from './DateField'
import { NumberField } from './NumberField'

const isoOf = (d: BDate | undefined) =>
  d && d[0] !== null && d[1] !== null && d[2] !== null && d[1] <= 12 && d[2] <= 31 ? `${d[0]}-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}` : ''
const dateOf = (iso: string): BDate => {
  if (!iso) return [null, null, null, null]
  const [y, m, d] = iso.split('-').map(Number)
  return [y, m, d, null]
}

/** One editor for any inline kind. */
export function FieldEditor({ shape, draft, onChange, disabled, label }: { shape: FieldShape; draft: unknown; onChange: (d: unknown) => void; disabled?: boolean; label: string }) {
  const box = 'flex h-9 items-center gap-2 rounded-[10px] border border-(--border-default) bg-(--surface-input) px-3 focus-within:border-(--ring)'
  switch (shape.kind) {
    case 'real':
    case 'unsigned':
    case 'integer':
      return <NumberField label={label} integer={shape.kind !== 'real'} units={shape.units} value={String(draft ?? '')} disabled={disabled} onChange={onChange} />
    case 'string':
      return (
        <label className={box}>
          <Input unstyled nativeInput aria-label={label} className="h-full min-w-0 flex-1 text-[13px]" maxLength={255} value={draft as string} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
        </label>
      )
    case 'boolean':
      return <Segmented label={label} options={[{ value: true, label: 'True' }, { value: false, label: 'False' }]} value={draft} onChange={onChange} disabled={disabled} />
    case 'enumerated': {
      const choices = shape.choices ?? []
      if (choices.length <= 4) return <Segmented label={label} options={choices} value={draft} onChange={onChange} disabled={disabled} />
      const items = choices.map((c) => ({ value: String(c.value), label: c.label }))
      return (
        <Select value={draft === null || draft === undefined ? null : String(draft)} items={items} onValueChange={(v) => onChange(Number(v))}>
          <SelectTrigger aria-label={label} disabled={disabled}><SelectValue placeholder="Choose one" /></SelectTrigger>
          <SelectPopup>{items.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectPopup>
        </Select>
      )
    }
    case 'bits': {
      const bits = draft as boolean[]
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
          {(shape.bits ?? []).map((name, i) => (
            <label key={name} className={cn('inline-flex h-8 cursor-pointer items-center gap-2 rounded-[9px] border px-2.5 text-[12.5px] transition-colors', bits[i] ? 'border-transparent bg-(--surface-checked)' : 'border-(--border-subtle)')}>
              <Checkbox checked={!!bits[i]} disabled={disabled} onCheckedChange={(v) => onChange(bits.map((b, j) => (j === i ? !!v : b)))} />
              {bitLabel(name)}
            </label>
          ))}
        </div>
      )
    }
    case 'string-array':
    case 'unsigned-array': {
      const items = draft as unknown[]
      return (
        <div className="flex flex-col gap-1" role="group" aria-label={label}>
          {items.map((x, i) => (
            <label key={i} className={cn(box, 'h-8')}>
              <span className="w-5 shrink-0 text-[11px] tabular-nums text-(--text-faint)">{i + 1}</span>
              <Input unstyled nativeInput aria-label={`${label} ${i + 1}`} inputMode={shape.kind === 'unsigned-array' ? 'numeric' : undefined} className="h-full min-w-0 flex-1 text-[13px]"
                value={String(x ?? '')} disabled={disabled} onChange={(e) => onChange(items.map((y, j) => (j === i ? e.target.value : y)))} />
            </label>
          ))}
        </div>
      )
    }
    case 'atomic': {
      const v = draft as { type: string; value: string }
      const types = ['real', 'unsigned', 'enumerated', 'boolean', 'null'].map((t) => ({ value: t, label: t === 'null' ? 'Null' : t[0].toUpperCase() + t.slice(1) }))
      return (
        <div className="flex gap-1.5">
          <Select value={v.type} items={types} onValueChange={(t) => onChange({ type: String(t), value: '' })}>
            <SelectTrigger aria-label={`${label} type`} className="w-[130px]" disabled={disabled}><SelectValue /></SelectTrigger>
            <SelectPopup>{types.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectPopup>
          </Select>
          {v.type === 'null' ? null : v.type === 'boolean' ? (
            <Segmented label={label} options={[{ value: 'true', label: 'True' }, { value: 'false', label: 'False' }]} value={v.value} onChange={(x) => onChange({ ...v, value: x })} disabled={disabled} />
          ) : (
            <NumberField className="flex-1" label={label} integer={v.type !== 'real'} value={v.value} disabled={disabled} onChange={(x) => onChange({ ...v, value: x })} />
          )}
        </div>
      )
    }
    case 'date-range': {
      const [a, b] = draft as [BDate, BDate]
      return (
        <div className="grid grid-cols-2 gap-1.5">
          {[a, b].map((d, i) => (
            <span key={i} className="flex min-w-0 flex-col gap-1">
              <span className="text-[11px] text-(--text-faint)">{i ? 'Until' : 'From'} · blank for any</span>
              <DateField label={`${label} ${i ? 'end' : 'start'}`} placeholder="Any date" clearable value={isoOf(d)} disabled={disabled}
                onChange={(iso) => onChange(i ? [a, dateOf(iso)] : [dateOf(iso), b])} />
            </span>
          ))}
        </div>
      )
    }
    default:
      return null
  }
}

function Segmented<T>({ label, options, value, onChange, disabled }: { label: string; options: { value: T; label: string }[]; value: unknown; onChange: (v: T) => void; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid flex-1 gap-1 rounded-[11px] bg-(--surface-track) p-[3px]" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => {
        const on = value === o.value
        return (
          <button key={String(o.value)} type="button" role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.value)} title={o.label}
            className={cn('h-8 min-w-0 truncate rounded-[8px] px-2 text-[12.5px] transition-colors', on ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'text-(--text-muted) hover:text-(--text-strong)')}>
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
