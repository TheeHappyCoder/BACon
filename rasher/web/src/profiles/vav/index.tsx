import { SERIES, type ChartSeries } from '@bacon/components/TrendChart'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Running } from '../../api'
import { BarDivider, BarStepper, BarToggle, FaceBar } from '../../components/controls'
import type { FaceProps, ProfileUI } from '..'
import { VavUnit } from './Unit'
import { ZonePanel } from './ZonePanel'

const { Users, Gauge } = Hugeicons

/** The VAV box with reheat, VC-1 (src/rasher/profiles/vav.py). */
export type Zone = {
  temp: number
  people: number
  autoPeople: boolean
  outside: number
  outsideOverride: number | null
  pressure: number
  pressureOverride: number | null
  flow: number
  flowSp: number
  damper: number
  damperCmd: number
  reheat: number
  heatLoop: number
  coolLoop: number
  discharge: number
  heatSp: number
  coolSp: number
  speed: number
}
export type VavRunning = Running & { zone: Zone }

type Trend = { zone: [number, number, number, number, number, number, number][] }

/** The zone sensor and box, and the two things that change a VAV's day most: people, and the AHU's duct pressure. */
function Face({ s: run, control, leds }: FaceProps) {
  const s = run as VavRunning
  const z = s.zone
  return (
    <>
      <div className="flex flex-1 flex-col justify-center py-2">
        <VavUnit s={s} control={control} leds={leds} />
      </div>
      <FaceBar>
        <BarStepper icon={Users} label="People" value={z.people} max={40} less="Fewer people" more="More people" onChange={(v) => control({ action: 'people', value: v })} />
        <BarDivider />
        <BarToggle icon={Gauge} on={z.pressureOverride != null && z.pressureOverride < 150} label="Low pressure" onLabel="Starved" onChange={(v) => control({ action: 'pressure', value: v ? 60 : null })} />
      </FaceBar>
    </>
  )
}

function Side({ s, control, leds }: FaceProps) {
  return (
    <>
      <div className="pt-4">
        <VavUnit s={s as VavRunning} control={control} leds={leds} />
      </div>
      <ZonePanel s={s as VavRunning} control={control} />
    </>
  )
}

const fmt = (v: number, u: string) => `${Number(v.toFixed(1))} ${u}`

export const vav: ProfileUI = {
  Face,
  Side,
  faults: {
    sensor: { title: 'Sensor fault', text: 'Zone temperature reads -50 °C with reliability open-loop.' },
    damper: { title: 'Stuck damper', text: 'The command moves, the blade and the airflow don’t.' },
  },
  scenarios: (run, control) => {
    const s = run as VavRunning
    const starved = s.zone.pressureOverride != null && s.zone.pressureOverride < 150
    return [
      { title: 'Overheat the zone', text: 'Zone temperature to 27.5 °C, past its 26 °C high limit. It alarms after 30 s.', go: () => control({ action: 'temp', value: 27.5 }) },
      { title: 'Starve the box', text: 'Duct pressure to 60 Pa: the damper opens fully and the airflow still falls short.', go: () => control({ action: 'pressure', value: starved ? null : 60 }), on: starved },
      { title: 'Stick the damper', text: 'The damper command keeps moving; the airflow doesn’t follow.', go: () => control({ action: 'fault', name: 'damper', value: !s.faults.damper }), on: !!s.faults.damper },
      { title: 'Break the sensor', text: 'The zone sensor reads -50 °C with reliability open-loop: a fault.', go: () => control({ action: 'fault', name: 'sensor', value: !s.faults.sensor }), on: !!s.faults.sensor },
    ]
  },
  charts: (d) => {
    const rows = (d as Trend | null)?.zone ?? []
    const series = (id: string, name: string, color: string, i: number, u: string, hold = false): ChartSeries => ({ id, name, color, points: rows.map((r) => [r[0], r[i], fmt(r[i], u)]), hold })
    return [
      { title: 'Temperature', unit: '°C', series: [series('t', 'Zone temperature', SERIES[0], 1, '°C'), series('s', 'Effective setpoint', SERIES[2], 2, '°C', true)] },
      { title: 'Airflow', unit: 'l/s', series: [series('f', 'Airflow', SERIES[0], 3, 'l/s'), series('fs', 'Airflow setpoint', SERIES[2], 4, 'l/s', true)] },
      { title: 'Damper and reheat', unit: '%', series: [series('d', 'Damper', SERIES[3], 5, '%'), series('r', 'Reheat valve', SERIES[1], 6, '%')] },
    ]
  },
}
