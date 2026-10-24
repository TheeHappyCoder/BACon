import { Hugeicons } from '@ui/components/hugeicons'
import { Switch } from '@ui/components/switch'
import type { Control, Point, Running } from '../api'

const { Minus, Plus } = Hugeicons

function Row({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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

function Stepper({ value, onChange, min = 0, max = 20 }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <span className="inline-flex h-8 items-center rounded-full bg-(--surface-track) p-[3px]">
      <button aria-label="Fewer" className="inline-flex size-[26px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) hover:text-(--text-strong) disabled:opacity-40" disabled={value <= min} onClick={() => onChange(value - 1)}>
        <Minus className="size-3.5" />
      </button>
      <span className="w-7 text-center text-[13px] font-medium tabular-nums">{value}</span>
      <button aria-label="More" className="inline-flex size-[26px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) hover:text-(--text-strong) disabled:opacity-40" disabled={value >= max} onClick={() => onChange(value + 1)}>
        <Plus className="size-3.5" />
      </button>
    </span>
  )
}

function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
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

/** An actuator bar: what the loop asks for, and what the room gets when something else holds the output. */
function Actuator({ label, point, loop, tone }: { label: string; point: Point; loop: number; tone: string }) {
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

export function RoomPanel({ s, control }: { s: Running; control: (c: Control) => void }) {
  const r = s.room
  const pt = (k: string) => s.points.find((p) => p.key === k) as Point
  const fan = pt('multi-state-output,1')
  const fanHeld = fan.activePriority != null && fan.activePriority < 16
  return (
    <div className="rounded-[18px] border border-(--border-subtle) bg-(--surface-card) px-4 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between pt-1.5 pb-1">
        <h2 className="text-[13px] font-medium">The room</h2>
        <span className="text-[11.5px] tabular-nums text-(--text-muted)">
          {r.humidity}% RH · outside {r.outside}°
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 pt-2 pb-1">
        <Actuator label="Heating" point={pt('analog-output,1')} loop={r.heatLoop} tone="#ff8a4c" />
        <Actuator label="Cooling" point={pt('analog-output,2')} loop={r.coolLoop} tone="#3d8bff" />
        <div className="min-w-0">
          <div className="flex items-baseline justify-between text-[11.5px]">
            <span className="text-(--text-muted)">Fan</span>
            <span className="font-medium text-(--text-strong)">{fan.display}</span>
          </div>
          <div className="mt-1 flex h-[6px] gap-[3px]">
            {[1, 2, 3].map((i) => (
              <span key={i} className="flex-1 rounded-full transition-colors" style={{ background: i <= Math.max(0, (fan.states ?? []).indexOf(fan.display)) ? 'var(--ink)' : 'var(--surface-track)' }} />
            ))}
          </div>
          <div className="mt-1 h-4 truncate text-[11px] text-(--text-muted)">{fanHeld ? `Held at priority ${fan.activePriority}` : 'Auto'}</div>
        </div>
      </div>

      <Row label="People" hint={r.autoPeople ? 'Following the office day' : 'Set by hand'}>
        <label className="flex items-center gap-1.5 text-[12px] text-(--text-muted)">
          Auto
          <Switch size="sm" checked={r.autoPeople} onCheckedChange={(v) => control({ action: 'people', value: v ? null : r.people })} />
        </label>
        <Stepper value={r.people} onChange={(v) => control({ action: 'people', value: v })} />
      </Row>
      <Row label="Window" hint={r.window ? 'Open: heating and cooling stop' : 'Closed'}>
        <Switch checked={r.window} onCheckedChange={(v) => control({ action: 'window', value: v })} />
      </Row>
      <Row label="Weather" hint={r.outsideOverride == null ? 'A normal day for the time' : `Fixed at ${r.outsideOverride}°`}>
        <Segmented
          value={r.outsideOverride == null ? 'auto' : r.outsideOverride <= 2 ? 'cold' : 'hot'}
          options={[
            { value: 'cold', label: 'Cold' },
            { value: 'auto', label: 'Normal' },
            { value: 'hot', label: 'Hot' },
          ]}
          onChange={(v) => control({ action: 'outside', value: v === 'auto' ? null : v === 'cold' ? -2 : 36 })}
        />
      </Row>
      <Row label="Room clock" hint={r.speed > 1 ? 'The room reacts faster; schedules keep real time' : 'Real time'}>
        <Segmented
          value={r.speed}
          options={[
            { value: 1, label: '1×' },
            { value: 30, label: '30×' },
            { value: 120, label: '120×' },
          ]}
          onChange={(v) => control({ action: 'speed', value: v })}
        />
      </Row>
    </div>
  )
}
