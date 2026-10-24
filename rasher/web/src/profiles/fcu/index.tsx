import { SERIES, type ChartSeries } from '@bacon/components/TrendChart'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Running } from '../../api'
import type { FaceProps, ProfileUI } from '..'
import { Faceplate } from './Faceplate'
import { RoomPanel } from './RoomPanel'

const { Users, Wind, Minus, Plus } = Hugeicons

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
