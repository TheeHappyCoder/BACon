import { Hugeicons } from '@ui/components/hugeicons'
import type { Control, Running } from '../api'
import { AddDevices } from '../components/AddDevices'
import { Leds } from '../components/Leds'
import { PowerSwitch } from '../components/PowerSwitch'
import { profileOf } from '../profiles'

const { PanelRight } = Hugeicons

/**
 * The small window: what makes it a device (instance, address, power) at the top, Add devices and More at the bottom,
 * and in between the profile's face: the unit and the controls people use most. Everything else is behind More.
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
  onAdd: (count: number, type?: string) => Promise<void>
  switcher?: React.ReactNode
  activityCount: number
}) {
  const { Face } = profileOf(s)
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

      <Face s={s} control={control} leds={<Leds s={s} activityCount={activityCount} />} />

      <footer className="flex items-center gap-1 px-2 pb-2.5">
        <AddDevices onAdd={onAdd} type={s.device.type} up />
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
