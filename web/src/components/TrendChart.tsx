import { useEffect, useMemo, useRef, useState } from 'react'

/* The categorical order from the dataviz reference palette, validated on this app's white surface (adjacent CVD
   ΔE 9.1, normal-vision 19.6). Colour follows the point: a point keeps its slot while it stays in the chart. */
export const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']

/** `hold`: the value holds until the next sample (COV), so it draws as steps and runs on to `holdUntil`. */
export type ChartSeries = { id: string; name: string; color: string; points: [number, number | null, string][]; hold?: boolean }

function niceTicks(lo: number, hi: number, count = 4) {
  if (lo === hi) {
    const pad = Math.abs(lo) * 0.1 || 1
    lo -= pad
    hi += pad
  }
  const raw = (hi - lo) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw
  const start = Math.floor(lo / step) * step
  const end = Math.ceil(hi / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(10)))
  return { lo: start, hi: end, ticks }
}

const compact = (v: number) => {
  const a = Math.abs(v)
  if (a >= 1e6) return `${(v / 1e6).toFixed(1).replace(/\.0$/, '')}M`
  if (a >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}K`
  return `${Number(v.toPrecision(4))}`
}

function timeLabel(t: number, span: number) {
  const d = new Date(t * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return span <= 900 ? `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}` : `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** A time chart with one y axis. Step lines for on/off and multi-state points. */
export function TrendChart({
  series,
  t0,
  t1,
  height = 180,
  step = false,
  unit = '',
  empty = 'Waiting for the first values…',
  holdUntil,
}: {
  holdUntil?: number
  series: ChartSeries[]
  t0: number
  t1: number
  height?: number
  step?: boolean
  unit?: string
  empty?: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hoverT, setHoverT] = useState<number | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const M = { l: 44, r: 14, t: 10, b: 24 }
  const iw = width - M.l - M.r
  const ih = height - M.t - M.b
  const values = series.flatMap((s) => s.points.map((p) => p[1]).filter((v): v is number => v !== null))
  const y = useMemo(() => (values.length ? niceTicks(Math.min(...values), Math.max(...values)) : null), [values.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps
  const span = Math.max(1, t1 - t0)
  const sx = (t: number) => M.l + ((t - t0) / span) * iw
  const sy = (v: number) => (y ? M.t + ih - ((v - y.lo) / (y.hi - y.lo || 1)) * ih : 0)

  const path = (pts: ChartSeries['points'], stepped: boolean, hold: boolean) => {
    let d = ''
    let prev: [number, number] | null = null
    for (const [t, v] of pts) {
      if (v === null) {
        prev = null
        continue
      }
      const X = sx(t)
      const Y = sy(v)
      if (!prev) d += `M${X.toFixed(1)},${Y.toFixed(1)}`
      else if (stepped) d += `H${X.toFixed(1)}V${Y.toFixed(1)}`
      else d += `L${X.toFixed(1)},${Y.toFixed(1)}`
      prev = [X, Y]
    }
    if (hold && prev && holdUntil) d += `H${Math.max(prev[0], sx(Math.min(holdUntil, t1))).toFixed(1)}`
    return d
  }
  const endOf = (s: ChartSeries) => {
    const last = [...s.points].reverse().find((p) => p[1] !== null)
    if (!last) return null
    return { t: s.hold && holdUntil ? Math.max(last[0], Math.min(holdUntil, t1)) : last[0], v: last[1] as number }
  }

  const xTicks = Array.from({ length: 5 }, (_, i) => t0 + (span * i) / 4)

  // the crosshair snaps to the nearest sample of any series
  const nearest = (pts: ChartSeries['points'], t: number) => {
    let best: ChartSeries['points'][number] | null = null
    for (const p of pts) if (p[1] !== null && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p
    return best
  }
  const hovered =
    hoverT === null
      ? null
      : (() => {
          const rows = series.map((s) => ({ s, p: step || s.hold ? [...s.points].reverse().find((p) => p[0] <= hoverT && p[1] !== null) ?? null : nearest(s.points, hoverT) }))
          const snap = rows.map((r) => r.p?.[0]).filter((v): v is number => v !== undefined)
          const t = snap.length ? snap.reduce((a, b) => (Math.abs(b - hoverT) < Math.abs(a - hoverT) ? b : a)) : hoverT
          return { t: step || series.some((s) => s.hold) ? hoverT : t, rows }
        })()

  if (!values.length || !y) {
    return (
      <div ref={wrap} className="flex items-center justify-center rounded-[12px] bg-(--surface-card-muted) text-[12.5px] text-(--text-muted)" style={{ height }}>
        {empty}
      </div>
    )
  }

  const hx = hovered ? sx(hovered.t) : 0
  return (
    <div ref={wrap} className="relative select-none" style={{ height }}>
      <svg width={width} height={height} className="block overflow-visible">
        {y.ticks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={M.l + iw} y1={sy(v)} y2={sy(v)} stroke="#ececec" strokeWidth={1} />
            <text x={M.l - 8} y={sy(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="#969696" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {compact(v)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text key={i} x={sx(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === 4 ? 'end' : 'middle'} fontSize={11} fill="#969696" style={{ fontVariantNumeric: 'tabular-nums' }}>
            {timeLabel(t, span)}
          </text>
        ))}
        {series.map((s) => (
          <path key={s.id} d={path(s.points, step || !!s.hold, !!s.hold)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {series.map((s) => {
          const end = endOf(s)
          return end ? <circle key={s.id} cx={sx(end.t)} cy={sy(end.v)} r={4} fill={s.color} stroke="#ffffff" strokeWidth={2} /> : null
        })}
        {hovered ? (
          <g>
            <line x1={hx} x2={hx} y1={M.t} y2={M.t + ih} stroke="#c4c4c4" strokeWidth={1} />
            {hovered.rows.map((r) =>
              r.p && r.p[1] !== null ? <circle key={r.s.id} cx={step || r.s.hold ? hx : sx(r.p[0])} cy={sy(r.p[1])} r={4} fill={r.s.color} stroke="#ffffff" strokeWidth={2} /> : null,
            )}
          </g>
        ) : null}
        <rect
          x={M.l}
          y={M.t}
          width={iw}
          height={ih}
          fill="transparent"
          onPointerMove={(e) => {
            const box = (e.currentTarget as SVGRectElement).getBoundingClientRect()
            setHoverT(t0 + ((e.clientX - box.left) / box.width) * span)
          }}
          onPointerLeave={() => setHoverT(null)}
        />
      </svg>
      {hovered ? (
        <div
          className="pointer-events-none absolute top-1 z-10 min-w-[150px] rounded-[10px] border border-white/8 bg-[#1a1a1c] px-2.5 py-2 text-[12px] text-white shadow-(--shadow-2)"
          style={hx > width * 0.62 ? { right: width - hx + 12 } : { left: hx + 12 }}
        >
          <div className="mb-1 text-[11px] text-white/60 tabular-nums">{new Date(hovered.t * 1000).toLocaleTimeString()}</div>
          {hovered.rows.map((r) => (
            <div key={r.s.id} className="flex items-center gap-2 py-px">
              <span className="h-[2px] w-3 shrink-0 rounded-full" style={{ background: r.s.color }} />
              <span className="font-medium tabular-nums">{r.p ? r.p[2] || compact(r.p[1] ?? 0) : '–'}</span>
              <span className="max-w-[180px] truncate text-white/60">{r.s.name}</span>
            </div>
          ))}
          {unit ? <div className="mt-1 text-[11px] text-white/50">{unit}</div> : null}
        </div>
      ) : null}
    </div>
  )
}
