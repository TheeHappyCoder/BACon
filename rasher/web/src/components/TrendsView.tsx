import { useEffect, useState } from 'react'
import { TrendChart, SERIES, type ChartSeries } from '@bacon/components/TrendChart'

type Trend = { room: [number, number, number, number, number][]; co2: [number, number][] }

const RANGES = [
  { hours: 2, label: '2 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
]

/** What the device's own trend logs hold: the same records a BMS gets with ReadRange. */
export function TrendsView({ instance }: { instance: number }) {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState<Trend>({ room: [], co2: [] })
  useEffect(() => {
    let stop = false
    const load = () =>
      fetch(`/api/d/${instance}/trend?hours=${hours}`)
        .then((r) => r.json())
        .then((d) => !stop && setData(d))
        .catch(() => {})
    load()
    const t = setInterval(load, 15000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [hours, instance])

  const t1 = Date.now() / 1000
  const t0 = t1 - hours * 3600
  const fmt = (v: number, u: string) => `${Number(v.toFixed(1))} ${u}`
  const temps: ChartSeries[] = [
    { id: 't', name: 'Room temperature', color: SERIES[0], points: data.room.map((r) => [r[0], r[1], fmt(r[1], '°C')]) },
    { id: 's', name: 'Effective setpoint', color: SERIES[2], points: data.room.map((r) => [r[0], r[2], fmt(r[2], '°C')]), hold: true },
  ]
  const valves: ChartSeries[] = [
    { id: 'h', name: 'Heating valve', color: SERIES[1], points: data.room.map((r) => [r[0], r[3], fmt(r[3], '%')]) },
    { id: 'c', name: 'Cooling valve', color: SERIES[0], points: data.room.map((r) => [r[0], r[4], fmt(r[4], '%')]) },
  ]
  const co2: ChartSeries[] = [{ id: 'co2', name: 'Room CO2', color: SERIES[3], points: data.co2.map((r) => [r[0], r[1], fmt(r[1], 'ppm')]) }]

  return (
    <div className="px-[18px] pt-3 pb-6">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12.5px] text-(--text-muted)">From the device's own trend logs, one record a minute, three days kept.</p>
        <span className="inline-flex h-8 items-center rounded-full bg-(--surface-track) p-[3px]">
          {RANGES.map((r) => (
            <button
              key={r.hours}
              onClick={() => setHours(r.hours)}
              className={`h-[26px] rounded-full px-2.5 text-[12px] ${hours === r.hours ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-(--text-muted)'}`}
            >
              {r.label}
            </button>
          ))}
        </span>
      </div>
      {[
        { title: 'Temperature', series: temps, unit: '°C' },
        { title: 'Valves', series: valves, unit: '%' },
        { title: 'CO2', series: co2, unit: 'ppm' },
      ].map((c) => (
        <section key={c.title} className="mb-3 rounded-[14px] border border-(--border-subtle) px-3.5 pt-3 pb-2">
          <div className="mb-1 flex items-center gap-3 text-[12px]">
            <span className="font-medium">{c.title}</span>
            {c.series.map((x) => (
              <span key={x.id} className="inline-flex items-center gap-1.5 text-(--text-muted)">
                <span className="h-[3px] w-3 rounded-full" style={{ background: x.color }} />
                {x.name}
              </span>
            ))}
          </div>
          <TrendChart series={c.series} t0={t0} t1={t1} height={150} unit={c.unit} empty="No records yet" />
        </section>
      ))}
    </div>
  )
}
