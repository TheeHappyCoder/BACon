import { SERIES, type ChartSeries } from '@bacon/components/TrendChart'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Running } from '../../api'
import { BarDivider, BarStepper, BarToggle, FaceBar } from '../../components/controls'
import type { FaceProps, ProfileUI } from '..'
import { BoardPanel } from './BoardPanel'
import { MeterUnit } from './Unit'

const { Zap, Unplug } = Hugeicons

/** The three-phase energy meter, EM-3 (src/rasher/profiles/meter.py). */
export type MeterState = {
  load: number
  autoLoad: boolean
  pfOverride: number | null
  total: number
  energy: number
  demand: number
  pf: number
  hz: number
  phases: { v: number; a: number; kw: number }[]
  speed: number
}
export type MeterRunning = Running & { meter: MeterState }

type Trend = { meter: [number, number, number, number, number][] }

/** The meter on its rail, and what changes its readings most: how much the floor draws, and losing a phase. */
function Face({ s: run, control, leds }: FaceProps) {
  const s = run as MeterRunning
  const m = s.meter
  return (
    <>
      <div className="flex flex-1 flex-col justify-center py-2">
        <MeterUnit s={s} leds={leds} />
      </div>
      <FaceBar>
        <BarStepper icon={Zap} label="Load" value={Math.round(m.load)} shown={`${Math.round(m.load)} kW`} step={5} max={200} less="Less load" more="More load" onChange={(v) => control({ action: 'load', value: v })} />
        <BarDivider />
        <BarToggle icon={Unplug} on={!!s.faults.phase} label="Lose L3" onLabel="L3 lost" onChange={(v) => control({ action: 'fault', name: 'phase', value: v })} />
      </FaceBar>
    </>
  )
}

function Side({ s, control, leds }: FaceProps) {
  return (
    <>
      <div className="pt-4">
        <MeterUnit s={s as MeterRunning} leds={leds} />
      </div>
      <BoardPanel s={s as MeterRunning} control={control} />
    </>
  )
}

const fmt = (v: number, u: string, d = 1) => `${Number(v.toFixed(d))} ${u}`

export const meter: ProfileUI = {
  Face,
  Side,
  faults: {
    phase: { title: 'Phase L3 lost', text: 'L3 voltage and current drop to zero; the phase failure input alarms after 5 s.' },
    ct: { title: 'CT on L2 reversed', text: 'L2 power reads negative, so the total and the power factor read low.' },
  },
  scenarios: (run, control) => {
    const s = run as MeterRunning
    const pushed = !s.meter.autoLoad && s.meter.load >= 70
    return [
      { title: 'Push the demand', text: '90 kW: the 15-minute demand climbs past its 55 kW limit (minutes at 120×).', go: () => control({ action: 'load', value: pushed ? null : 90 }), on: pushed },
      { title: 'Lose a phase', text: 'L3 drops out: the phase failure input alarms after 5 s.', go: () => control({ action: 'fault', name: 'phase', value: !s.faults.phase }), on: !!s.faults.phase },
      { title: 'Reverse a CT', text: 'L2 reads negative: total power and power factor drop, but nothing alarms.', go: () => control({ action: 'fault', name: 'ct', value: !s.faults.ct }), on: !!s.faults.ct },
      { title: 'Motors on', text: 'Power factor 0.8: more current for the same power.', go: () => control({ action: 'pf', value: s.meter.pfOverride == null ? 0.8 : null }), on: s.meter.pfOverride != null },
    ]
  },
  charts: (d) => {
    const rows = (d as Trend | null)?.meter ?? []
    const series = (id: string, name: string, color: string, i: number, u: string, digits = 1, hold = false): ChartSeries => ({ id, name, color, points: rows.map((r) => [r[0], r[i], fmt(r[i], u, digits)]), hold })
    return [
      { title: 'Power', unit: 'kW', series: [series('p', 'Active power', SERIES[0], 1, 'kW'), series('d', 'Demand', SERIES[2], 2, 'kW', 1, true)] },
      { title: 'Power factor', unit: '', series: [series('pf', 'Power factor', SERIES[3], 3, '', 3)] },
      { title: 'Energy', unit: 'kWh', series: [series('e', 'Active energy', SERIES[1], 4, 'kWh')] },
    ]
  },
}
