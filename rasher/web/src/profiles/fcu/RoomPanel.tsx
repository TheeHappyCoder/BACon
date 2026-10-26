import { Switch } from '@ui/components/switch'
import type { Control, Point } from '../../api'
import { Actuator, ClockRow, Panel, Row, Stepper, WeatherRow } from '../../components/controls'
import type { FcuRunning } from '.'

export function RoomPanel({ s, control }: { s: FcuRunning; control: (c: Control) => void }) {
  const r = s.room
  const pt = (k: string) => s.points.find((p) => p.key === k) as Point
  const fan = pt('multi-state-output,1')
  const fanHeld = fan.activePriority != null && fan.activePriority < 16
  return (
    <Panel
      title="The room"
      aside={
        <>
          {r.humidity}% RH · outside {r.outside}°
        </>
      }
    >
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
          <div className="mt-1 h-4 truncate text-[11px] text-(--text-muted)">{fanHeld ? `Held at priority ${fan.activePriority}` : r.fanMode && r.fanMode !== 'Auto' ? `${r.fanMode}, set on the unit` : r.system === 'Off' ? 'Unit off' : 'Auto'}</div>
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
      <WeatherRow override={r.outsideOverride} onChange={(v) => control({ action: 'outside', value: v })} />
      <ClockRow label="Room clock" faster="The room reacts faster" speed={r.speed} onChange={(v) => control({ action: 'speed', value: v })} />
    </Panel>
  )
}
