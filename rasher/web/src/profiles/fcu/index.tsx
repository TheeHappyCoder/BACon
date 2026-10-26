import { SERIES, type ChartSeries } from '@bacon/components/TrendChart'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Running } from '../../api'
import { BarDivider, BarStepper, BarToggle, FaceBar } from '../../components/controls'
import type { FaceProps, ProfileUI } from '..'
import { Faceplate } from './Faceplate'
import { RoomPanel } from './RoomPanel'

const { Users, Wind } = Hugeicons

/** The fan coil room controller, RC-1 (src/rasher/profiles/fcu.py). */
export type Room = {
  temp: number
  humidity: number
  co2: number
  people: number
  autoPeople: boolean
  window: boolean
  outside: number
  outsideOverride: number | null
  heat: number
  cool: number
  heatLoop: number
  coolLoop: number
  fan: string
  heatSp: number
  coolSp: number
  speed: number
  /** the room unit's mode and fan keys */
  system: 'Auto' | 'Heat' | 'Cool' | 'Fan only' | 'Off'
  fanMode: 'Auto' | 'Low' | 'Medium' | 'High'
}
export type FcuRunning = Running & { room: Room }

type Trend = { room: [number, number, number, number, number][]; co2: [number, number][] }

/** The room unit as you'd find it on the wall, and the two things people change most: who's in the room, the window. */
function Face({ s: run, control, leds }: FaceProps) {
  const s = run as FcuRunning
  const r = s.room
  return (
    <>
      <div className="flex flex-1 flex-col justify-center py-2">
        <Faceplate s={s} control={control} leds={leds} />
      </div>

      {/* the room around the unit */}
      <FaceBar>
        <BarStepper icon={Users} label="People" value={r.people} max={20} less="Fewer people" more="More people" onChange={(v) => control({ action: 'people', value: v })} />
        <BarDivider />
        <BarToggle icon={Wind} on={r.window} label="Window" onLabel="Window open" onChange={(v) => control({ action: 'window', value: v })} />
      </FaceBar>
    </>
  )
}

function Side({ s, control, leds }: FaceProps) {
  return (
    <>
      <div className="pt-4">
        <Faceplate s={s as FcuRunning} control={control} leds={leds} />
      </div>
      <RoomPanel s={s as FcuRunning} control={control} />
    </>
  )
}

const fmt = (v: number, u: string) => `${Number(v.toFixed(1))} ${u}`

export const fcu: ProfileUI = {
  Face,
  Side,
  faults: { sensor: { title: 'Sensor fault', text: 'Room temperature reads -50 °C with reliability open-loop.' } },
  scenarios: (run, control) => {
    const s = run as FcuRunning
    return [
      { title: 'Overheat the room', text: 'Room temperature to 27.5 °C, past its 26 °C high limit. It alarms after 30 s.', go: () => control({ action: 'temp', value: 27.5 }) },
      { title: 'Open the window', text: 'The window contact alarms after 5 s, and heating and cooling stop.', go: () => control({ action: 'window', value: !s.room.window }), on: s.room.window },
      { title: 'Break the sensor', text: 'The room sensor reads -50 °C with reliability open-loop: a fault.', go: () => control({ action: 'fault', name: 'sensor', value: !s.faults.sensor }), on: !!s.faults.sensor },
      { title: 'Pack the room', text: 'Twelve people: CO2 climbs past 1200 ppm within a few minutes (faster at 120×).', go: () => control({ action: 'people', value: s.room.people >= 12 ? null : 12 }), on: s.room.people >= 12 },
    ]
  },
  charts: (d) => {
    const data = (d as Trend | null) ?? { room: [], co2: [] }
    const temps: ChartSeries[] = [
      { id: 't', name: 'Room temperature', color: SERIES[0], points: data.room.map((r) => [r[0], r[1], fmt(r[1], '°C')]) },
      { id: 's', name: 'Effective setpoint', color: SERIES[2], points: data.room.map((r) => [r[0], r[2], fmt(r[2], '°C')]), hold: true },
    ]
    const valves: ChartSeries[] = [
      { id: 'h', name: 'Heating valve', color: SERIES[1], points: data.room.map((r) => [r[0], r[3], fmt(r[3], '%')]) },
      { id: 'c', name: 'Cooling valve', color: SERIES[0], points: data.room.map((r) => [r[0], r[4], fmt(r[4], '%')]) },
    ]
    const co2: ChartSeries[] = [{ id: 'co2', name: 'Room CO2', color: SERIES[3], points: data.co2.map((r) => [r[0], r[1], fmt(r[1], 'ppm')]) }]
    return [
      { title: 'Temperature', series: temps, unit: '°C' },
      { title: 'Valves', series: valves, unit: '%' },
      { title: 'CO2', series: co2, unit: 'ppm' },
    ]
  },
}
