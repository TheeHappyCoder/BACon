import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Bucket, TrendPoint, TrendStats } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { cn } from '../ui/utils'
import { SERIES } from './TrendChart'
import { SPIN } from './spin'

const { MoreHorizontal, ArrowRight, XIcon, ReloadIcon } = Hugeicons

const PAD_R = 20
const ACTIVE = new Set(['active', 'true', '1', 'on'])
export const isBinary = (p: TrendPoint) => [3, 4, 5].includes(p.sourceType ?? p.typeId)
export const isStates = (p: TrendPoint) => [13, 14, 19].includes(p.sourceType ?? p.typeId)
const SHORT: Record<string, string> = { 'degrees-celsius': '°C', 'degrees-fahrenheit': '°F', 'delta-degrees-kelvin': 'K', percent: '%', 'percent-relative-humidity': '%RH', 'parts-per-million': 'ppm', pascals: 'Pa', kilowatts: 'kW', 'liters-per-second': 'l/s' }
export const unitText = (p: TrendPoint) => (p.units && p.units !== 'no-units' ? SHORT[p.units] ?? p.units.replaceAll('-', ' ') : '')
const num = (v: number | null | undefined, digits = 4) => (v === null || v === undefined || !Number.isFinite(v) ? '–' : Number(v.toPrecision(digits)).toLocaleString())
const isOn = (text: string, avg: number | null) => ACTIVE.has(String(text).toLowerCase()) || (avg !== null && avg >= 0.5)

type Kind = 'analog' | 'binary' | 'states'
/** Each kind of lane has its own columns: the numbers that say most about it. */
const COLUMNS: Record<Kind, { label: string; w: number }[]> = {
  analog: [
    { label: 'Now', w: 92 },
    { label: 'Min', w: 64 },
    { label: 'Avg', w: 64 },
    { label: 'Max', w: 64 },
    { label: 'Change', w: 68 },
  ],
  binary: [
    { label: 'Now', w: 92 },
    { label: 'On', w: 112 },
    { label: 'Starts', w: 60 },
    { label: 'Runtime', w: 86 },
  ],
  states: [
    { label: 'Now', w: 92 },
    { label: 'Mostly', w: 170 },
    { label: 'Changes', w: 70 },
  ],
}
const POINT_W = 230
const LEFT_W = POINT_W + Math.max(...Object.values(COLUMNS).map((c) => c.reduce((a, x) => a + x.w, 0))) + 24
const H: Record<Kind, number> = { analog: 52, binary: 30, states: 30 }

/** 75 s → "1 min", 5400 → "1 h 30 min", 2 days → "2 d 0 h" */
export function span(sec: number) {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  if (s < 3600) return `${Math.round(s / 60)} min`
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`
}

/** Ticks on round local times, at most about six. */
function timeTicks(t0: number, t1: number) {
  const steps = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400]
  const step = steps.find((s) => (t1 - t0) / s <= 6) ?? 86400 * Math.ceil((t1 - t0) / 86400 / 6)
  const offset = new Date().getTimezoneOffset() * 60
  const out: number[] = []
  for (let t = Math.ceil((t0 + offset) / step) * step - offset; t <= t1; t += step) out.push(t)
  const days = t1 - t0 > 86400
  return out.map((t) => ({ t, label: new Date(t * 1000).toLocaleString([], days ? { weekday: 'short', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit' }) }))
}

/** A smooth path through the points that never overshoots them (monotone cubic, as d3's curveMonotoneX). */
function slopes(xy: [number, number][]) {
  const n = xy.length
  if (n < 3) return null
  const slope = (i: number) => (xy[i + 1][1] - xy[i][1]) / (xy[i + 1][0] - xy[i][0] || 1)
  const m: number[] = new Array(n)
  m[0] = slope(0)
  m[n - 1] = slope(n - 2)
  for (let i = 1; i < n - 1; i++) {
    const a = slope(i - 1)
    const b = slope(i)
    m[i] = a * b <= 0 ? 0 : (3 * (a + b)) / ((2 * b + a) / b + (2 * a + b) / a)
  }
  return m
}

/** The curve's height at x. Its control points are a third of the way along each segment, so x moves evenly with the
 * curve's parameter and y is the cubic at that parameter; past the last point it holds level. */
function yAt(xy: [number, number][], x: number) {
  if (!xy.length) return null
  if (x <= xy[0][0]) return xy[0][1]
  if (x >= xy[xy.length - 1][0]) return xy[xy.length - 1][1]
  const m = slopes(xy)
  let i = 0
  while (i < xy.length - 2 && xy[i + 1][0] < x) i++
  const [x0, y0] = xy[i]
  const [x1, y1] = xy[i + 1]
  const t = (x - x0) / (x1 - x0 || 1)
  if (!m) return y0 + (y1 - y0) * t
  const dx = (x1 - x0) / 3
  const c1 = y0 + m[i] * dx
  const c2 = y1 - m[i + 1] * dx
  const u = 1 - t
  return u * u * u * y0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * y1
}

function smooth(xy: [number, number][]) {
  const m = slopes(xy)
  if (!m) return xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')
  const n = xy.length
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = xy[i]
    const [x1, y1] = xy[i + 1]
    const dx = (x1 - x0) / 3
    d += `C${(x0 + dx).toFixed(1)},${(y0 + m[i] * dx).toFixed(1)} ${(x1 - dx).toFixed(1)},${(y1 - m[i + 1] * dx).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`
  }
  return d
}

/** The bucket in force at time t: the last one that starts at or before it. */
function at(buckets: Bucket[], t: number) {
  let lo = 0
  let hi = buckets.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (buckets[mid][0] <= t) {
      found = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return found < 0 ? null : buckets[found]
}

function kindOf(p: TrendPoint): Kind {
  return isBinary(p) ? 'binary' : isStates(p) ? 'states' : 'analog'
}

/** The trace: an area under a line for numbers, a lime bar while on, labelled segments for states. */
function Trace({ kind, buckets, t0, t1, width, end, hoverT, labelOf }: { kind: Kind; buckets: Bucket[]; t0: number; t1: number; width: number; end: number; hoverT: number | null; labelOf: (text: string) => string }) {
  const gid = useId()
  const h = H[kind]
  const sx = (t: number) => Math.max(0, ((t - t0) / Math.max(1, t1 - t0)) * width)
  if (!buckets.length) return <svg width={width} height={h} className="block" />

  if (kind === 'analog') {
    const pts = buckets.filter((b) => b[1] !== null) as [number, number, number | null, number | null, string][]
    if (!pts.length) return <svg width={width} height={h} className="block" />
    const vals = pts.map((b) => b[1])
    let lo = Math.min(...vals)
    let hi = Math.max(...vals)
    const flat = hi - lo < 1e-9
    if (flat) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.15
    const sy = (v: number) => 4 + (1 - (v - (lo - pad)) / (hi - lo + 2 * pad)) * (h - 8)
    const last = pts[pts.length - 1]
    const xEnd = sx(Math.max(end, last[0]))
    const xy = pts.map((b) => [sx(b[0]), sy(b[1])] as [number, number])
    let line = smooth(xy)
    line += `H${xEnd.toFixed(1)}`
    const area = `${line}V${h}H${sx(pts[0][0]).toFixed(1)}Z`
    const hover = hoverT !== null ? at(pts as unknown as Bucket[], hoverT) : null
    return (
      <svg width={width} height={h} className="block overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ns-green)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--color-ns-green)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--trend-line)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        {hover && hover[1] !== null ? (
          <circle cx={sx(hoverT!)} cy={yAt(xy, sx(hoverT!)) ?? sy(hover[1])} r={4} fill="var(--color-ns-green)" stroke="var(--ink)" strokeWidth={1.5} />
        ) : (
          <circle cx={xEnd} cy={sy(last[1])} r={3.5} fill="var(--color-ns-green)" stroke="var(--trend-line)" strokeWidth={1.5} />
        )}
      </svg>
    )
  }

  // runs of one value
  const runs: { from: number; to: number; text: string; on: boolean }[] = []
  buckets.forEach((b, i) => {
    const to = i + 1 < buckets.length ? buckets[i + 1][0] : Math.max(end, b[0])
    const prev = runs[runs.length - 1]
    if (prev && prev.text === b[4]) prev.to = to
    else runs.push({ from: b[0], to, text: b[4], on: isOn(b[4], b[1]) })
  })
  return (
    <svg width={width} height={h} className="block">
      {runs.map((r, i) => {
        const x = sx(r.from)
        const w = Math.max(2, sx(r.to) - x)
        if (kind === 'binary')
          return r.on ? (
            <g key={i}>
              <rect x={x} y={3} width={w} height={h - 6} rx={4} fill="var(--color-ns-green)" />
              <rect x={x} y={3} width={2.5} height={h - 6} rx={1} fill="var(--ink)" />
            </g>
          ) : (
            <rect key={i} x={x} y={h / 2 - 0.75} width={w} height={1.5} rx={0.75} fill="var(--border-strong)" />
          )
        const color = SERIES[(Math.max(1, Number(r.text) || 1) - 1) % SERIES.length]
        return (
          <g key={i}>
            <rect x={x} y={3} width={w} height={h - 6} rx={4} fill={color} opacity={0.2} />
            <rect x={x} y={3} width={2.5} height={h - 6} rx={1} fill={color} />
            {w > 52 ? (
              <text x={x + 8} y={h / 2 + 4} className="fill-(--text-strong) text-[11.5px]">
                {labelOf(r.text)}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

type LaneProps = {
  p: TrendPoint
  kind: Kind
  buckets: Bucket[]
  s: TrendStats | undefined
  t0: number
  t1: number
  width: number
  hold: boolean
  hoverT: number | null
  showDevice: boolean
  labelOf: (p: TrendPoint, text: string) => string
  menu: ReactNode
}

function Lane({ p, kind, buckets, s, t0, t1, width, hold, hoverT, showDevice, labelOf, menu }: LaneProps) {
  const u = unitText(p)
  const end = hold ? t1 : (buckets[buckets.length - 1]?.[0] ?? t1)
  const hovered = hoverT !== null ? at(buckets, hoverT) : null
  const nowText = p.last ? (kind === 'analog' && Number.isFinite(Number(p.last)) ? `${num(Number(p.last))}${u ? ` ${u}` : ''}` : labelOf(p, p.last)) : '–'
  const hoverText = hovered ? (kind === 'analog' ? (hovered[1] === null ? hovered[4] : `${num(hovered[1])}${u ? ` ${u}` : ''}`) : labelOf(p, hovered[4])) : '–'

  let cells: ReactNode[] = []
  if (kind === 'analog') {
    const change = s && s.first !== null && s.last !== null ? s.last - s.first : null
    cells = [
      num(s?.min),
      num(s?.avg),
      num(s?.max),
      <span key="c" className={cn(change && Math.abs(change) > 1e-9 ? 'text-(--text-strong)' : 'text-(--text-faint)')}>
        {change === null ? '–' : Math.abs(change) < 1e-9 ? '0' : `${change > 0 ? '+' : '−'}${num(Math.abs(change), 3)}`}
      </span>,
    ]
  } else if (kind === 'binary') {
    const total = s?.states ? Object.values(s.states).reduce((a, b) => a + b, 0) : 0
    const onFor = s?.states ? Object.entries(s.states).filter(([k]) => ACTIVE.has(k.toLowerCase())).reduce((a, [, v]) => a + v, 0) : 0
    const share = total ? onFor / total : 0
    const starts = s ? (ACTIVE.has((s.firstText ?? '').toLowerCase()) ? Math.floor(s.changes / 2) : Math.ceil(s.changes / 2)) : 0
    cells = [
      <span key="on" className="flex items-center gap-2">
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-(--surface-track)">
          <span className="block h-full rounded-full bg-(--ink)" style={{ width: `${share * 100}%` }} />
        </span>
        <span className="w-8 text-right">{total ? `${Math.round(share * 100)}%` : '–'}</span>
      </span>,
      s ? String(starts) : '–',
      total ? span(onFor) : '–',
    ]
  } else {
    const top = s?.states ? Object.entries(s.states).sort((a, b) => b[1] - a[1])[0] : null
    const total = s?.states ? Object.values(s.states).reduce((a, b) => a + b, 0) : 0
    cells = [top && total ? `${labelOf(p, top[0])} · ${Math.round((top[1] / total) * 100)}%` : '–', s ? String(s.changes) : '–']
  }

  const problem = p.method === 'error' ? p.error : p.log?.state === 'error' || p.log?.state === 'unsupported' ? p.log.error : ''
  const sub = problem ? (
    <span className="truncate text-(--status-alarm-strong)" title={problem}>
      {problem}
    </span>
  ) : p.log?.state === 'loading' ? (
    <span className="flex items-center gap-1">
      <ReloadIcon className={cn('size-3', SPIN)} />
      reading the log {p.log.total ? `${Math.min(p.log.loaded, p.log.total).toLocaleString()} / ${p.log.total.toLocaleString()}` : '…'}
    </span>
  ) : !p.samples ? (
    'waiting for the first value'
  ) : showDevice ? (
    p.deviceName
  ) : p.log ? (
    'trend log'
  ) : p.method === 'cov' ? (
    'on change'
  ) : p.method === 'poll' ? (
    'on the timer'
  ) : null
  const cols = COLUMNS[kind]

  return (
    <div className="group/lane flex items-center border-b border-(--border-divider) transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_2.5%,transparent)]">
      <div className="flex shrink-0 items-center py-2 pl-6 text-[12.5px] tabular-nums" style={{ width: LEFT_W }}>
        <span className="flex min-w-0 flex-col pr-3" style={{ width: POINT_W }}>
          <span className="truncate text-[13px] font-medium" title={p.name}>
            {p.name}
          </span>
          {sub ? <span className="flex min-w-0 text-[11.5px] text-(--text-muted)">{sub}</span> : null}
        </span>
        <span className={cn('shrink-0 truncate pr-3 text-right text-[13px] font-medium', hoverT !== null && (hovered ? 'text-(--trend-line)' : 'font-normal text-(--text-faint)'))} style={{ width: cols[0].w }}>
          {hoverT !== null ? hoverText : nowText}
        </span>
        {cells.map((c, i) => (
          <span key={i} className={cn('min-w-0 shrink-0 truncate pr-3 text-(--text-muted)', !(kind !== 'analog' && i === 0) && 'text-right')} style={{ width: cols[i + 1].w }}>
            {c}
          </span>
        ))}
        <span className="ml-auto pr-2 opacity-0 group-hover/lane:opacity-100 has-data-popup-open:opacity-100">{menu}</span>
      </div>
      <div className="min-w-0 flex-1 py-2" style={{ paddingRight: PAD_R }}>
        <Trace kind={kind} buckets={buckets} t0={t0} t1={t1} width={width} end={end} hoverT={hoverT} labelOf={(text) => labelOf(p, text)} />
      </div>
    </div>
  )
}

/**
 * A trend group's points as lanes on one time line, sorted into sections that read the same way: one per unit, then
 * on/off, then states. Each section has its own column headings; hover reads every lane at one moment.
 */
export function TrendLanes({
  points,
  data,
  stats,
  t0,
  t1,
  hold,
  labelOf,
  onShow,
  onRemove,
  onSync,
}: {
  points: TrendPoint[]
  data: Record<string, Bucket[]>
  stats: Record<string, TrendStats>
  t0: number
  t1: number
  hold: boolean
  labelOf: (p: TrendPoint, text: string) => string
  onShow: (p: TrendPoint) => void
  onRemove: (p: TrendPoint) => void
  onSync: (p: TrendPoint) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(800)
  const [hoverX, setHoverX] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width) - LEFT_W - PAD_R))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const w = Math.max(80, width)
  const hoverT = hoverX === null ? null : t0 + (hoverX / w) * (t1 - t0)
  const ticks = useMemo(() => timeTicks(t0, t1), [t0, t1])
  const xOf = (t: number) => ((t - t0) / Math.max(1, t1 - t0)) * w
  const showDevice = new Set(points.map((p) => p.device)).size > 1

  const sections = useMemo(() => {
    const by = new Map<string, { title: string; kind: Kind; points: TrendPoint[] }>()
    for (const p of points) {
      const kind = kindOf(p)
      const u = unitText(p)
      const key = kind === 'analog' ? `u:${u}` : kind
      const title = kind === 'analog' ? (u ? `In ${u}` : 'Numbers') : kind === 'binary' ? 'On / off' : 'States'
      const e = by.get(key) ?? { title, kind, points: [] }
      e.points.push(p)
      by.set(key, e)
    }
    const order: Kind[] = ['analog', 'binary', 'states']
    return [...by.values()].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
  }, [points])

  return (
    <div
      ref={ref}
      className="relative overflow-x-clip pb-6"
      onMouseMove={(e) => {
        const box = ref.current!.getBoundingClientRect()
        const x = e.clientX - box.left - LEFT_W
        setHoverX(x >= 0 && x <= w ? x : null)
      }}
      onMouseLeave={() => setHoverX(null)}
    >
      {/* tick lines and the cursor, across every lane */}
      <div className="pointer-events-none absolute top-0 bottom-6 z-[1]" style={{ left: LEFT_W, width: w }}>
        {ticks.map((t) => (
          <span key={t.t} className="absolute inset-y-0 w-px bg-(--border-divider)" style={{ left: xOf(t.t) }} />
        ))}
        {hoverX !== null ? <span className="absolute inset-y-0 w-px bg-(--ink)/35" style={{ left: hoverX }} /> : null}
      </div>

      <div className="relative z-[2]">
        {sections.map((sec) => (
          <section key={sec.title}>
            <div className="sticky top-0 z-[3] flex h-9 items-center border-b border-(--border-subtle) bg-(--surface-card-muted) pl-6 text-[11.5px] text-(--text-muted)">
              <span className="flex shrink-0 items-baseline gap-1.5 pr-3 font-medium text-(--text-strong)" style={{ width: POINT_W }}>
                {sec.title}
                <span className="font-normal text-(--text-faint) tabular-nums">{sec.points.length}</span>
              </span>
              {COLUMNS[sec.kind].map((c, i) => (
                <span key={c.label} className={cn('shrink-0 pr-3', !(sec.kind !== 'analog' && i === 1) && 'text-right')} style={{ width: c.w }}>
                  {c.label}
                </span>
              ))}
              {/* the time line: ticks along the lanes, and the moment under the cursor as an ink pill */}
              <div className="relative ml-auto h-full shrink-0" style={{ width: w, marginRight: PAD_R }}>
                {ticks.filter((t) => xOf(t.t) > 32 && xOf(t.t) < w - 32).map((t) => (
                  <span
                    key={t.t}
                    className={cn('absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[11px] whitespace-nowrap text-(--text-faint) tabular-nums transition-opacity', hoverX !== null && Math.abs(xOf(t.t) - hoverX) < 56 && 'opacity-0')}
                    style={{ left: xOf(t.t) }}
                  >
                    {t.label}
                  </span>
                ))}
                {hoverT !== null ? (
                  <span
                    className="absolute top-1/2 z-[1] rounded-full bg-(--pill-dark) px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-white tabular-nums shadow-[0_2px_6px_rgba(0,0,0,.18)]"
                    style={{ left: Math.min(Math.max(hoverX!, 34), w - 34), transform: 'translate(-50%, -50%)' }}
                  >
                    {new Date(hoverT * 1000).toLocaleTimeString([], { weekday: t1 - t0 > 86400 ? 'short' : undefined, hour: '2-digit', minute: '2-digit' })}
                  </span>
                ) : null}
              </div>
            </div>
            {sec.points.map((p) => (
              <Lane
                key={p.id}
                p={p}
                kind={sec.kind}
                buckets={data[String(p.id)] ?? []}
                s={stats[String(p.id)]}
                t0={t0}
                t1={t1}
                width={w}
                hold={hold}
                hoverT={hoverT}
                showDevice={showDevice}
                labelOf={labelOf}
                menu={
                  <Menu>
                    <MenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Actions for ${p.name}`} />}>
                      <MoreHorizontal />
                    </MenuTrigger>
                    <MenuPopup align="end" className="w-52">
                      <MenuItem onClick={() => onShow(p)}>
                        <ArrowRight />
                        Show in Objects
                      </MenuItem>
                      {p.log ? (
                        <MenuItem onClick={() => onSync(p)}>
                          <ReloadIcon />
                          Read the log again
                        </MenuItem>
                      ) : null}
                      <MenuSeparator />
                      <MenuItem variant="destructive" onClick={() => onRemove(p)}>
                        <XIcon />
                        Remove from group
                      </MenuItem>
                    </MenuPopup>
                  </Menu>
                }
              />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
