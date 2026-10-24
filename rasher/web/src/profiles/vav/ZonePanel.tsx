import { Switch } from '@ui/components/switch'
import type { Control, Point } from '../../api'
import { Actuator, ClockRow, Panel, Row, Segmented, Stepper, WeatherRow } from '../../components/controls'
import type { VavRunning } from '.'

/** Airflow against its setpoint, on the scale of the box's maximum. */
function Airflow({ flow, sp, max }: { flow: number; sp: number; max: number }) {
  const pct = (v: number) => Math.max(0, Math.min(100, (v / Math.max(max, 1)) * 100))
  const short = sp > 20 && flow < sp * 0.85
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11.5px]">
        <span className="text-(--text-muted)">Airflow</span>
        <span className="font-medium tabular-nums text-(--text-strong)">{Math.round(flow)}</span>
      </div>
      <div className="relative mt-1 h-[6px] overflow-hidden rounded-full bg-(--surface-track)">
        <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${pct(flow)}%`, background: short ? 'var(--status-warn-strong)' : '#3d8bff' }} />
        <div className="absolute inset-y-[-2px] w-[2px] rounded-full bg-(--ink)" style={{ left: `calc(${pct(sp)}% - 1px)` }} title={`Setpoint ${Math.round(sp)} l/s`} />
      </div>
      <div className="mt-1 h-4 truncate text-[11px] text-(--text-muted)">{short ? `Short of ${Math.round(sp)} l/s` : `Set ${Math.round(sp)} l/s`}</div>
    </div>
  )
}

export function ZonePanel({ s, control }: { s: VavRunning; control: (c: Control) => void }) {
  const z = s.zone
  const pt = (k: string) => s.points.find((p) => p.key === k) as Point
  const pressure = z.pressureOverride == null ? 'auto' : z.pressureOverride < 150 ? 'low' : 'high'
  return (
    <Panel title="The zone" aside={<>outside {z.outside}° · duct {z.pressure} Pa</>}>
      <div className="grid grid-cols-3 gap-3 pt-2 pb-1">
        <Airflow flow={z.flow} sp={z.flowSp} max={Number(pt('analog-value,5').value ?? 350)} />
        <Actuator label="Damper" point={pt('analog-output,1')} loop={z.damperCmd} tone="var(--ink)" />
        <Actuator label="Reheat" point={pt('analog-output,2')} loop={z.heatLoop} tone="#ff8a4c" />
      </div>

      <Row label="People" hint={z.autoPeople ? 'Following the office day' : 'Set by hand'}>
        <label className="flex items-center gap-1.5 text-[12px] text-(--text-muted)">
          Auto
          <Switch size="sm" checked={z.autoPeople} onCheckedChange={(v) => control({ action: 'people', value: v ? null : z.people })} />
        </label>
        <Stepper value={z.people} max={40} onChange={(v) => control({ action: 'people', value: v })} />
      </Row>
      <Row label="Duct pressure" hint={pressure === 'auto' ? 'The AHU holds its design 250 Pa' : pressure === 'low' ? 'Starved: the box can’t reach its airflow' : 'High: the damper closes down'}>
        <Segmented
          value={pressure}
          options={[
            { value: 'low', label: 'Low' },
            { value: 'auto', label: 'Design' },
            { value: 'high', label: 'High' },
          ]}
          onChange={(v) => control({ action: 'pressure', value: v === 'auto' ? null : v === 'low' ? 60 : 450 })}
        />
      </Row>
      <WeatherRow override={z.outsideOverride} onChange={(v) => control({ action: 'outside', value: v })} />
      <ClockRow label="Zone clock" faster="The zone reacts faster" speed={z.speed} onChange={(v) => control({ action: 'speed', value: v })} />
    </Panel>
  )
}
