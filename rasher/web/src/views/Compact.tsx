import { Hugeicons } from '@ui/components/hugeicons'
import type { Control, Point, Running } from '../api'
import { AddDevices } from '../components/AddDevices'
import { Faceplate } from '../components/Faceplate'
import { PowerSwitch } from '../components/PowerSwitch'

const { Users, Wind, PanelRight, Minus, Plus } = Hugeicons

/**
 * The small window: the room unit as you'd find it on the wall, what makes it a device (instance, address, power),
 * and the two things people change most (who's in the room, the window). Everything else is behind More.
 */
export function Compact({
  s,
  control,
  onExpand,
  onAdd,
  switcher,
  activityCount,
}: {
  s: Running
  control: (c: Control) => void
  onExpand: () => void
  onAdd: (count: number) => Promise<void>
  switcher?: React.ReactNode
  activityCount: number
}) {
  const r = s.room
  const mode = s.points.find((p) => p.key === 'multi-state-value,1') as Point
  const on = s.device.powered
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-(--surface-page) text-(--text-strong) select-none">
      <header className="flex items-start gap-3 px-4 pt-3.5 pb-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-medium tracking-[-0.01em]">{s.device.name}</div>
          <div className="truncate text-[12px] tabular-nums text-(--text-muted)">
            Device {s.device.instance} · {s.device.ip}:{s.device.port}
          </div>
        </div>
        <PowerSwitch on={on} booting={s.device.restarting} onChange={(v) => control({ action: 'power', value: v })} />
      </header>

      <div className="flex flex-1 flex-col justify-center py-2">
        <Faceplate
          s={s}
          activityCount={activityCount}
          onOffset={(v) => control({ action: 'offset', value: v })}
          onPresence={() =>
            mode.activePriority === 8
              ? control({ action: 'release', key: 'multi-state-value,1', priority: 8 })
              : control({ action: 'write', key: 'multi-state-value,1', value: 1, priority: 8 })
          }
        />
      </div>

      {/* the room around the unit */}
      <div className="mx-3 mb-2 flex items-center gap-2 rounded-[14px] border border-(--border-subtle) bg-(--surface-card) px-2.5 py-1.5">
        <Users className="size-4 text-(--text-muted)" />
        <span className="text-[12.5px] text-(--text-muted)">People</span>
        <span className="ml-auto inline-flex h-7 items-center rounded-full bg-(--surface-track) p-[2px]">
          <button aria-label="Fewer people" className="inline-flex size-6 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) disabled:opacity-40" disabled={r.people <= 0} onClick={() => control({ action: 'people', value: r.people - 1 })}>
            <Minus className="size-3" />
          </button>
          <span className="w-6 text-center text-[12.5px] font-medium tabular-nums">{r.people}</span>
          <button aria-label="More people" className="inline-flex size-6 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) disabled:opacity-40" disabled={r.people >= 20} onClick={() => control({ action: 'people', value: r.people + 1 })}>
            <Plus className="size-3" />
          </button>
        </span>
        <span className="mx-1 h-4 w-px bg-(--border-subtle)" />
        <button
          onClick={() => control({ action: 'window', value: !r.window })}
          aria-pressed={r.window}
          className={`inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] transition-colors ${r.window ? 'bg-(--status-info-bg) text-(--text-strong)' : 'text-(--text-muted) hover:bg-(--surface-track)'}`}
        >
          <Wind className="size-3.5" />
          {r.window ? 'Window open' : 'Window'}
        </button>
      </div>

      <footer className="flex items-center gap-1 px-2 pb-2.5">
        <AddDevices onAdd={onAdd} up />
        {switcher}
        <div className="flex-1" />
        <button onClick={onExpand} className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)">
          More
          <PanelRight className="size-3.5" />
        </button>
      </footer>
    </div>
  )
}
