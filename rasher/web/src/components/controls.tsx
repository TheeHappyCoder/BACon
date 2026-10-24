import { useEffect, useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Point } from '../api'

const { Minus, Plus } = Hugeicons

type Icon = React.ComponentType<{ className?: string }>

/** The device's clock as HH:MM, shifted by the offset a time sync left. */
export function useClock(offset = 0) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const d = new Date(now + offset * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- the bar under a unit in the small window: the controls people use most -----------------------------------

export function FaceBar({ children }: { children: React.ReactNode }) {
  return <div className="mx-3 mb-2 flex items-center gap-2 rounded-[14px] border border-(--border-subtle) bg-(--surface-card) px-2.5 py-1.5">{children}</div>
}

export function BarDivider() {
  return <span className="mx-1 h-4 w-px bg-(--border-subtle)" />
}

export function BarStepper({ icon: I, label, value, shown, onChange, min = 0, max, step = 1, less, more }: {
  icon: Icon
  label: string
  value: number
  shown?: string
  onChange: (v: number) => void
  min?: number
  max: number
  step?: number
  less: string
  more: string
}) {
  return (
    <>
      <I className="size-4 text-(--text-muted)" />
      <span className="text-[12.5px] text-(--text-muted)">{label}</span>
      <span className="ml-auto inline-flex h-7 items-center rounded-full bg-(--surface-track) p-[2px]">
        <button aria-label={less} className="inline-flex size-6 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) disabled:opacity-40" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
          <Minus className="size-3" />
        </button>
        <span className={`${shown ? 'min-w-6 px-1' : 'w-6'} text-center text-[12.5px] font-medium tabular-nums`}>{shown ?? value}</span>
        <button aria-label={more} className="inline-flex size-6 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) disabled:opacity-40" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
          <Plus className="size-3" />
        </button>
      </span>
    </>
  )
}

export function BarToggle({ icon: I, on, label, onLabel, onChange }: { icon: Icon; on: boolean; label: string; onLabel: string; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      aria-pressed={on}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] whitespace-nowrap transition-colors ${on ? 'bg-(--status-info-bg) text-(--text-strong)' : 'text-(--text-muted) hover:bg-(--surface-track)'}`}
    >
      <I className="size-3.5" />
      {on ? onLabel : label}
    </button>
  )
}

// ---- the panel beside the unit in the full view ------------------------------------------------------------------

export function Panel({ title, aside, children }: { title: string; aside: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-[18px] border border-(--border-subtle) bg-(--surface-card) px-4 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between pt-1.5 pb-1">
        <h2 className="text-[13px] font-medium">{title}</h2>
        <span className="text-[11.5px] tabular-nums text-(--text-muted)">{aside}</span>
      </div>
      {children}
    </div>
  )
}

export function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[40px] items-center gap-3 border-t border-(--border-subtle) first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] text-(--text-strong)">{label}</div>
        {hint ? <div className="truncate text-[11.5px] text-(--text-muted)">{hint}</div> : null}
      </div>
      {children}
    </div>
  )
}

export function Stepper({ value, shown, onChange, min = 0, max = 20, step = 1 }: { value: number; shown?: string; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <span className="inline-flex h-8 items-center rounded-full bg-(--surface-track) p-[3px]">
      <button aria-label="Fewer" className="inline-flex size-[26px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) hover:text-(--text-strong) disabled:opacity-40" disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
        <Minus className="size-3.5" />
      </button>
      <span className={`${shown ? 'min-w-7 px-1' : 'w-7'} text-center text-[13px] font-medium tabular-nums`}>{shown ?? value}</span>
      <button aria-label="More" className="inline-flex size-[26px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) hover:text-(--text-strong) disabled:opacity-40" disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
        <Plus className="size-3.5" />
      </button>
    </span>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span className="inline-flex h-8 items-center rounded-full bg-(--surface-track) p-[3px]">
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          className={`h-[26px] rounded-full px-2.5 text-[12px] tabular-nums transition-colors ${o.value === value ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-(--text-muted) hover:text-(--text-strong)'}`}
        >
          {o.label}
        </button>
      ))}
    </span>
  )
}

/** An actuator bar: what the loop asks for, and what the plant gets when something else holds the output. */
export function Actuator({ label, point, loop, tone }: { label: string; point: Point; loop: number; tone: string }) {
  const value = Number(point.value ?? 0)
  const held = point.activePriority != null && point.activePriority < 16
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-(--text-muted)">{label}</span>
        <span className="font-medium tabular-nums text-(--text-strong)">{Math.round(value)}%</span>
      </div>
      <div className="relative mt-1 h-[6px] overflow-hidden rounded-full bg-(--surface-track)">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${value}%`, background: tone }} />
        {held ? <div className="absolute inset-y-[-2px] w-[2px] rounded-full bg-(--ink)" style={{ left: `calc(${loop}% - 1px)` }} title={`The loop wants ${Math.round(loop)}%`} /> : null}
      </div>
      <div className="mt-1 h-4 truncate text-[11px] text-(--text-muted)">{held ? `Held at priority ${point.activePriority}` : 'Loop'}</div>
    </div>
  )
}

/** Speed for the model's clock, in the panel: the same three choices on every profile. */
export function ClockRow({ label, faster, speed, onChange }: { label: string; faster: string; speed: number; onChange: (v: number) => void }) {
  return (
    <Row label={label} hint={speed > 1 ? `${faster}; schedules keep real time` : 'Real time'}>
      <Segmented
        value={speed}
        options={[
          { value: 1, label: '1×' },
          { value: 30, label: '30×' },
          { value: 120, label: '120×' },
        ]}
        onChange={onChange}
      />
    </Row>
  )
}

/** Fix the outside air cold or hot, or let it follow the day. */
export function WeatherRow({ override, onChange }: { override: number | null; onChange: (v: number | null) => void }) {
  return (
    <Row label="Weather" hint={override == null ? 'A normal day for the time' : `Fixed at ${override}°`}>
      <Segmented
        value={override == null ? 'auto' : override <= 2 ? 'cold' : 'hot'}
        options={[
          { value: 'cold', label: 'Cold' },
          { value: 'auto', label: 'Normal' },
          { value: 'hot', label: 'Hot' },
        ]}
        onChange={(v) => onChange(v === 'auto' ? null : v === 'cold' ? -2 : 36)}
      />
    </Row>
  )
}
