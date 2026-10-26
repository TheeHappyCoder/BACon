import { cn } from '../ui/utils'
import { Input } from '../ui/components/input'

/**
 * A number as typed, not the browser's spinner box: text with a decimal keypad, the units after it, and the arrow keys
 * stepping by one (Shift: ten). The draft stays a string; whoever reads it parses and checks it.
 */
export function NumberField({
  value,
  onChange,
  label,
  units,
  placeholder,
  disabled,
  integer,
  size = 'md',
  className,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  units?: string
  placeholder?: string
  disabled?: boolean
  /** whole numbers only: the keypad drops the decimal point and steps stay whole */
  integer?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const step = (dir: 1 | -1, big: boolean) => {
    const n = Number(value)
    const next = (Number.isFinite(n) && value.trim() !== '' ? n : 0) + dir * (big ? 10 : 1)
    // keep the decimals the user typed, so 21.5 steps to 22.5, not 22.499999
    const places = integer ? 0 : (value.split('.')[1] ?? '').length
    onChange(next.toFixed(places))
  }
  return (
    <label
      className={cn(
        'flex items-center gap-2 rounded-[10px] border border-(--border-default) bg-(--surface-input) px-3 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors focus-within:border-(--ring) hover:border-(--border-strong)',
        size === 'sm' ? 'h-7 rounded-[8px] px-2' : size === 'lg' ? 'h-11 rounded-[12px] px-3.5' : 'h-9',
        disabled && 'opacity-60',
        className,
      )}
    >
      <Input
        unstyled
        nativeInput
        aria-label={label}
        role="spinbutton"
        aria-valuenow={value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined}
        inputMode={integer ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        className={cn('h-full min-w-0 flex-1 tabular-nums', size === 'sm' ? 'text-[12.5px]' : size === 'lg' ? 'text-[17px] font-medium tracking-[-0.01em]' : 'text-[14px]')}
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value.replace(integer ? /[^\d-]/g : /[^\d.,eE+-]/g, '').replace(',', '.'))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            step(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
          }
        }}
      />
      {units ? <span className={cn('shrink-0 text-(--text-muted)', size === 'lg' ? 'text-[14px]' : 'text-[12.5px]')}>{units}</span> : null}
    </label>
  )
}
