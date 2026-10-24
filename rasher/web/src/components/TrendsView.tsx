import { useEffect, useState } from 'react'
import { TrendChart } from '@bacon/components/TrendChart'
import type { Chart } from '../profiles'

const RANGES = [
  { hours: 2, label: '2 hours' },
  { hours: 24, label: '24 hours' },
  { hours: 72, label: '3 days' },
]

/** What the device's own trend logs hold: the same records a BMS gets with ReadRange. The profile picks the charts. */
export function TrendsView({ instance, charts }: { instance: number; charts: (data: unknown) => Chart[] }) {
  const [hours, setHours] = useState(24)
  const [data, setData] = useState<unknown>(null)
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
      {charts(data).map((c) => (
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
