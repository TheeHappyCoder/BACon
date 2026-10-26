import { useState } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Popover, PopoverPopup, PopoverTrigger } from '../ui/components/popover'
import { cn } from '../ui/utils'

const { ChevronLeft, ChevronRight, Calendar } = Hugeicons

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const pad = (n: number) => String(n).padStart(2, '0')
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`
const parse = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? { y: Number(m[1]), m: Number(m[2]) - 1, d: Number(m[3]) } : null
}
const today = () => {
  const t = new Date()
  return isoOf(t.getFullYear(), t.getMonth(), t.getDate())
}
/** "26 Oct 2026" */
const show = (iso: string) => {
  const p = parse(iso)
  return p ? new Date(p.y, p.m, p.d).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : ''
}

/**
 * A date as a button and a month calendar in a popover, Monday first. The value is ISO (YYYY-MM-DD); empty means none,
 * which BACnet reads as any date when the field allows it.
 */
export function DateField({
  value,
  onChange,
  label,
  placeholder = 'Pick a date',
  clearable,
  disabled,
  size = 'md',
  className,
}: {
  value: string
  onChange: (iso: string) => void
  label: string
  placeholder?: string
  clearable?: boolean
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const picked = parse(value)
  const start = picked ?? parse(today())!
  const [month, setMonth] = useState({ y: start.y, m: start.m })
  const first = new Date(month.y, month.m, 1)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const days = new Date(month.y, month.m + 1, 0).getDate()
  const cells = [...Array.from({ length: lead }, () => null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const now = today()
  const move = (dir: 1 | -1) => setMonth(({ y, m }) => (m + dir < 0 ? { y: y - 1, m: 11 } : m + dir > 11 ? { y: y + 1, m: 0 } : { y, m: m + dir }))
  const choose = (iso: string) => {
    onChange(iso)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setMonth({ y: start.y, m: start.m })
      }}
    >
      <PopoverTrigger
        disabled={disabled}
        aria-label={label}
        className={cn(
          'inline-flex min-w-0 items-center gap-2 border border-(--border-default) bg-(--surface-input) text-left tabular-nums shadow-[0_1px_2px_rgba(0,0,0,.04)] outline-none transition-colors hover:border-(--border-strong) focus-visible:border-(--ring) data-popup-open:border-(--ring) disabled:opacity-60',
          size === 'sm' ? 'h-7 rounded-[8px] px-2 text-[12.5px]' : 'h-9 rounded-[10px] px-3 text-[13px]',
          className,
        )}
      >
        <Calendar className={cn('shrink-0 text-(--text-faint)', size === 'sm' ? 'size-3.5' : 'size-4')} />
        <span className={cn('min-w-0 flex-1 truncate', !value && 'text-(--text-faint)')}>{value ? show(value) : placeholder}</span>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-[264px]">
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" aria-label="Previous month" onClick={() => move(-1)} className="inline-flex size-7 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)">
              <ChevronLeft className="size-4" />
            </button>
            <span className="text-[13px] font-medium">{first.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
            <button type="button" aria-label="Next month" onClick={() => move(1)} className="inline-flex size-7 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)">
              <ChevronRight className="size-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-0.5 text-center" role="grid" aria-label={label}>
            {WEEKDAYS.map((w) => (
              <span key={w} className="pb-1 text-[11px] text-(--text-faint)">{w}</span>
            ))}
            {cells.map((d, i) => {
              if (d === null) return <span key={`x${i}`} />
              const iso = isoOf(month.y, month.m, d)
              const on = iso === value
              return (
                <button
                  key={iso}
                  type="button"
                  aria-pressed={on}
                  aria-label={show(iso)}
                  onClick={() => choose(iso)}
                  className={cn(
                    'inline-flex h-8 items-center justify-center rounded-[8px] text-[12.5px] tabular-nums transition-colors',
                    on ? 'bg-(--ink) font-medium text-(--color-ns-green)' : 'hover:bg-(--surface-track)',
                    !on && iso === now && 'shadow-[inset_0_0_0_1px_var(--border-strong)] font-medium',
                  )}
                >
                  {d}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-(--border-divider) pt-2 text-[12px]">
            <button type="button" onClick={() => choose(now)} className="rounded-full px-2 py-1 font-medium text-(--text-strong) hover:bg-(--surface-track)">
              Today
            </button>
            {clearable && value ? (
              <button type="button" onClick={() => choose('')} className="rounded-full px-2 py-1 text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)">
                Clear
              </button>
            ) : null}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  )
}
