import { useState } from 'react'
import { Input } from '../ui/components/input'
import { cn } from '../ui/utils'

const pad = (n: number) => String(n).padStart(2, '0')

/** "7" → 07:00, "730" → 07:30, "7:5" → 07:05, "1745" → 17:45; anything else is not a time. */
function normalise(text: string): string | null {
  const t = text.trim()
  const m = /^(\d{1,2})(?::?(\d{1,2}))?$/.exec(t.includes(':') ? t : t.length > 2 ? `${t.slice(0, -2)}:${t.slice(-2)}` : t)
  if (!m) return null
  const h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  return h < 24 && min < 60 ? `${pad(h)}:${pad(min)}` : null
}

/**
 * A 24-hour time typed as you would say it: 7, 730 or 17:45. Arrow keys move it by 15 minutes (Shift: an hour). The
 * value is HH:MM and only changes when what is typed is a time.
 */
export function TimeField({ value, onChange, label, className }: { value: string; onChange: (hhmm: string) => void; label: string; className?: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const bad = draft !== null && draft.trim() !== '' && normalise(draft) === null
  const shift = (minutes: number) => {
    const [h, m] = (normalise(draft ?? value) ?? '00:00').split(':').map(Number)
    const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440
    setDraft(null)
    onChange(`${pad(Math.floor(total / 60))}:${pad(total % 60)}`)
  }
  return (
    <Input
      unstyled
      nativeInput
      aria-label={label}
      aria-invalid={bad || undefined}
      inputMode="numeric"
      autoComplete="off"
      spellCheck={false}
      placeholder="hh:mm"
      className={cn('w-[52px] bg-transparent text-[12.5px] tabular-nums outline-none placeholder:text-(--text-faint) aria-invalid:text-(--status-alarm-strong)', className)}
      value={draft ?? value}
      onChange={(e) => {
        const text = e.target.value.replace(/[^\d:]/g, '').slice(0, 5)
        setDraft(text)
        const t = normalise(text)
        if (t && (text.includes(':') ? text.length >= 4 : text.length >= 3)) onChange(t)
      }}
      onBlur={() => {
        const t = draft === null ? null : normalise(draft)
        if (t) onChange(t)
        setDraft(null)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          shift((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 60 : 15))
        }
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}
