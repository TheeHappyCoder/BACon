import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { api, type Bucket, type Device, type ObjectRow, type Status, type TrendPoint, type TrendStatus } from '../api'
import { AddPointsSheet } from './AddPointsSheet'
import { Button } from '../ui/components/button'
import { Input } from '../ui/components/input'
import { Hugeicons } from '../ui/components/hugeicons'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { Popover, PopoverPopup, PopoverTrigger } from '../ui/components/popover'
import { ScrollArea } from '../ui/components/scroll-area'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { LAYOUT } from '../ui/motion'
import { cn } from '../ui/utils'
import { SERIES, TrendChart, type ChartSeries } from './TrendChart'
import { Pane, PaneToggle } from './Layout'
import { useToast } from './Toasts'

const { MoreHorizontal, FileSpreadsheet, FileText, Trash2, XIcon, ArrowRight, ChevronDown, Plus, Play, Timer } = Hugeicons

const RANGES = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400, all: 0 } as const
type Range = keyof typeof RANGES
const RANGE_LABEL: Record<Range, string> = { '15m': '15 min', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours', all: 'All' }
const PRESETS = [5, 10, 30, 60, 300, 900, 1800, 3600]
const UNITS = [
  { value: '1', label: 'seconds' },
  { value: '60', label: 'minutes' },
  { value: '3600', label: 'hours' },
]
const MAX_INTERVAL = 24 * 3600

/** 30 → "30 s", 1800 → "30 min", 5400 → "1 h 30 min" */
function fmtInterval(sec: number) {
  if (sec < 60) return `${sec} s`
  if (sec < 3600) return Number.isInteger(sec / 60) ? `${sec / 60} min` : `${Math.floor(sec / 60)} min ${sec % 60} s`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Points share a chart only when they share a unit, so a chart never needs a second axis. */
function groupOf(p: TrendPoint): { key: string; label: string; step: boolean } {
  if (p.units && p.units !== 'no-units') return { key: `u:${p.units}`, label: p.units, step: false }
  if ([3, 4, 5].includes(p.typeId)) return { key: 'binary', label: 'On / off', step: true }
  if ([13, 14, 19].includes(p.typeId)) return { key: 'multistate', label: 'States', step: true }
  return { key: 'none', label: 'No units', step: false }
}

function elapsed(from: number, to: number) {
  const s = Math.max(0, Math.round(to - from))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const p = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`
}

const num = (v: number | null) => (v === null || v === undefined ? '–' : Number(v.toPrecision(5)).toString())

function ago(t: number) {
  if (!t) return 'never'
  const s = Math.round(Date.now() / 1000 - t)
  if (s < 5) return 'just now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(t * 1000).toLocaleTimeString()
}

function MethodPill({ p, dark }: { p: TrendPoint; dark?: boolean }) {
  const label = p.method === 'cov' ? 'COV' : p.method === 'poll' ? 'polled' : p.method === 'error' ? 'unreadable' : p.method === 'stopped' ? 'stopped' : 'waiting'
  return (
    <span
      title={p.method === 'error' ? p.error : p.method === 'poll' && p.note ? `COV was refused: ${p.note}` : undefined}
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center rounded-full px-2 text-[11px] leading-none',
        dark
          ? 'bg-white/10 text-white/80'
          : p.method === 'cov'
            ? 'bg-(--color-ns-green-light)'
            : p.method === 'error'
              ? 'bg-(--status-alarm-bg)'
              : 'bg-(--surface-track) text-(--text-muted)',
      )}
    >
      {label}
    </span>
  )
}

/** The empty points list: faded stand-ins for the rows to come. The main panel carries the Add points button. */
function EmptyPoints() {
  return (
    <div className="nc-view-in mt-1 flex flex-col">
      <div className="overflow-hidden rounded-[12px] border border-(--border-subtle) bg-(--surface-card)" aria-hidden="true">
        {[1, 0.6, 0.3].map((o, i) => (
          <div key={i} className="flex h-11 items-center gap-2.5 border-t border-(--border-divider) px-2.5 first:border-t-0">
            <span className="h-6 w-[3px] shrink-0 rounded-full" style={{ background: SERIES[i], opacity: o }} />
            <span className="flex min-w-0 flex-1 flex-col gap-1.5" style={{ opacity: o }}>
              <span className="h-2 rounded-full bg-(--surface-track)" style={{ width: `${[68, 52, 60][i]}%` }} />
              <span className="h-1.5 rounded-full bg-(--surface-track)" style={{ width: `${[40, 46, 34][i]}%` }} />
            </span>
            <span className="h-2 w-8 shrink-0 rounded-full bg-(--surface-track)" style={{ opacity: o }} />
          </div>
        ))}
      </div>
      <div className="mt-3 px-1 text-[13px] font-medium">No points yet</div>
      <div className="mt-0.5 px-1 text-[12px] leading-snug text-(--text-muted)">Points you add show up here with their live values.</div>
    </div>
  )
}

function Sparkline({ points }: { points: [number, number | null, string][] }) {
  const vals = points.filter((p) => p[1] !== null) as [number, number, string][]
  if (vals.length < 2) return <div className="h-12" />
  const t0 = vals[0][0]
  const t1 = vals[vals.length - 1][0]
  const lo = Math.min(...vals.map((v) => v[1]))
  const hi = Math.max(...vals.map((v) => v[1]))
  const W = 280
  const H = 48
  const d = vals
    .map((v, i) => `${i ? 'L' : 'M'}${(((v[0] - t0) / (t1 - t0 || 1)) * W).toFixed(1)},${(H - 4 - ((v[1] - lo) / (hi - lo || 1)) * (H - 8)).toFixed(1)}`)
    .join('')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-12 w-full" preserveAspectRatio="none">
      <path d={d} fill="none" stroke="#c6f56f" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * The recorder: one control that holds how it records and the start/stop action. Idle it is a light pill (settings |
 * Start); recording it becomes the ink capsule with the live clock, and the settings segment shows the next read.
 */
function Recorder({
  running,
  clock,
  samples,
  resumable,
  connected,
  label,
  next,
  busy,
  onStart,
  onStop,
  settings,
}: {
  running: boolean
  clock: string
  samples: number
  resumable: boolean
  connected: boolean
  label: string
  next: string
  busy: boolean
  onStart: () => void
  onStop: () => void
  settings: React.ReactNode
}) {
  const seg = running ? 'outline-none focus-visible:ring-2 focus-visible:ring-white/35 text-white/70 hover:bg-white/10 hover:text-white data-popup-open:bg-white/10' : 'text-(--text-strong) hover:bg-(--surface-hover) data-popup-open:bg-(--surface-hover)'
  return (
    <motion.div
      layout
      transition={LAYOUT}
      className={cn(
        'flex h-9 shrink-0 items-center gap-0.5 rounded-full p-[3px] text-[13px] transition-colors duration-300',
        running ? 'bg-[#1c1c1f] text-white shadow-(--shadow-sheet)' : 'border border-(--border-default) bg-(--surface-card)',
      )}
    >
      {running ? (
        <motion.span layout="position" className="flex items-center gap-2 pr-2 pl-3 tabular-nums">
          <span className="relative inline-flex size-2">
            <span className="nc-ping absolute inset-0 rounded-full bg-[#c6f56f]" />
            <span className="relative inline-flex size-2 rounded-full bg-[#c6f56f]" />
          </span>
          <span className="font-medium">{clock}</span>
          <span className="text-white/50">{samples.toLocaleString()} samples</span>
        </motion.span>
      ) : null}
      <Popover>
        <PopoverTrigger
          render={
            <motion.button
              layout="position"
              title={running ? 'How it records (stop to change)' : 'How it records'}
              className={cn('inline-flex h-full min-w-[164px] items-center gap-1.5 rounded-full px-3 transition-colors', seg)}
            />
          }
        >
          <Timer className="size-3.5 opacity-70" />
          {/* the label keeps one shape in both modes, so switching mode in the popover doesn't move it */}
          <span className="flex-1 text-left tabular-nums">{label}</span>
          {next ? <span className={running ? 'text-white/45' : 'text-(--text-muted)'}>· {next}</span> : null}
          <ChevronDown className="size-3 opacity-60" />
        </PopoverTrigger>
        <PopoverPopup align="end" className="w-[320px]">
          {settings}
        </PopoverPopup>
      </Popover>
      {running ? (
        <motion.button
          layout="position"
          onClick={onStop}
          disabled={busy}
          className="inline-flex h-full items-center gap-1.5 rounded-full bg-white/10 px-3 font-medium text-white transition-colors hover:bg-white/20 outline-none focus-visible:ring-2 focus-visible:ring-white/35"
        >
          <span className="size-2.5 rounded-[3px] bg-white" />
          Stop
        </motion.button>
      ) : (
        <motion.span layout="position" className="h-full">
          <Button size="sm" className="h-full" loading={busy} disabled={!connected} title={connected ? undefined : 'Connect to a network first'} onClick={onStart}>
            <Play />
            {resumable ? 'Resume' : 'Start recording'}
          </Button>
        </motion.span>
      )}
    </motion.div>
  )
}

/** How a session records: on change (COV, timer as fallback) or on a timer, and how often, from 1 s to 24 h. */
function RecordSettings({
  mode,
  interval,
  locked,
  onMode,
  onInterval,
}: {
  mode: string
  interval: number
  locked: boolean
  onMode: (m: string) => void
  onInterval: (sec: number) => void
}) {
  const preset = PRESETS.includes(interval)
  const unit = interval % 3600 === 0 ? 3600 : interval % 60 === 0 ? 60 : 1
  const [custom, setCustom] = useState(!preset)
  const [amount, setAmount] = useState(String(interval / unit))
  const [unitS, setUnit] = useState(String(unit))
  const applyCustom = (a: string, u: string) => {
    const sec = Math.round(Number(a) * Number(u))
    if (sec >= 1) onInterval(Math.min(sec, MAX_INTERVAL))
  }
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="text-[13px] font-medium">How it records</div>
      <Tabs value={mode} onValueChange={(v) => !locked && onMode(v as string)}>
        <TabsList className="w-full">
          <TabsTab value="auto" className="flex-1" disabled={locked && mode !== 'auto'}>
            On change
          </TabsTab>
          <TabsTab value="poll" className="flex-1" disabled={locked && mode !== 'poll'}>
            On a timer
          </TabsTab>
        </TabsList>
      </Tabs>
      <div className="flex flex-col gap-1.5">
        {/* the timer only applies to what is polled */}
        <span className="text-[12px] text-(--text-muted)">{mode === 'auto' ? 'Read points without COV every' : 'Read every point every'}</span>
        <div className="grid grid-cols-4 gap-1">
          {PRESETS.map((sec) => (
            <button
              key={sec}
              disabled={locked}
              onClick={() => {
                const u = sec % 3600 === 0 ? 3600 : sec % 60 === 0 ? 60 : 1
                setCustom(false)
                setAmount(String(sec / u))
                setUnit(String(u))
                onInterval(sec)
              }}
              className={cn(
                'h-7 rounded-full text-[12px] tabular-nums transition-colors disabled:opacity-50',
                !custom && interval === sec ? 'bg-(--ink) text-white' : 'bg-(--surface-track) text-(--text-muted) hover:text-(--text-strong)',
              )}
            >
              {fmtInterval(sec)}
            </button>
          ))}
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          <button
            disabled={locked}
            onClick={() => {
              setCustom(true)
              applyCustom(amount, unitS)
            }}
            className={cn(
              'h-7 shrink-0 rounded-full px-3 text-[12px] transition-colors disabled:opacity-50',
              custom ? 'bg-(--ink) text-white' : 'bg-(--surface-track) text-(--text-muted) hover:text-(--text-strong)',
            )}
          >
            Custom
          </button>
          <Input
            size="sm"
            type="number"
            min={1}
            disabled={locked}
            aria-label="Interval"
            className="w-[64px] min-w-0 text-[12.5px] tabular-nums"
            value={amount}
            onFocus={() => setCustom(true)}
            onChange={(e) => {
              setAmount(e.target.value)
              setCustom(true)
              applyCustom(e.target.value, unitS)
            }}
          />
          <Select
            value={unitS}
            items={UNITS}
            disabled={locked}
            onValueChange={(v) => {
              setUnit(v as string)
              setCustom(true)
              applyCustom(amount, v as string)
            }}
          >
            <SelectTrigger size="sm" className="min-w-0 flex-1 text-[12.5px]">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {UNITS.map((u) => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      </div>
      <p className="m-0 text-[11.5px] leading-snug text-(--text-muted)">
        {locked
          ? 'Stop recording to change these.'
          : mode === 'auto'
            ? `Each change is recorded the moment the controller sends it. Points whose controller refuses COV are read every ${fmtInterval(interval)}.`
            : `Every point is read every ${fmtInterval(interval)}, batched per controller. Up to 24 hours.`}
      </p>
    </div>
  )
}

export function TrendsView({
  status,
  trends,
  onTrends,
  onShowInObjects,
  onGoToObjects,
  allRows,
  devices,
  onAddRows,
}: {
  allRows: ObjectRow[]
  devices: Device[]
  onAddRows: (rows: ObjectRow[]) => void
  status: Status
  trends: TrendStatus
  onTrends: (t: TrendStatus) => void
  onShowInObjects: (p: TrendPoint) => void
  onGoToObjects: () => void
}) {
  const toast = useToast()
  const [range, setRange] = useState<Range>('all')
  const [draftInterval, setIntervalS] = useState(String(trends.interval || 10))
  const [draftMode, setMode] = useState<string>(trends.mode || 'auto')
  // while recording the card shows what the backend is actually doing; edits apply to the next start
  const mode = trends.running ? trends.mode : draftMode
  const interval = trends.running ? String(trends.interval) : draftInterval
  useEffect(() => {
    if (trends.running) {
      setMode(trends.mode)
      setIntervalS(String(trends.interval))
    }
  }, [trends.running, trends.mode, trends.interval])
  const [data, setData] = useState<Record<string, Bucket[]>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const trendedKeys = useMemo(() => new Set(trends.points.map((p) => `${p.device}:${p.typeId},${p.instance}`)), [trends.points])

  const ids = trends.points.map((p) => p.id)
  const idsKey = ids.join(',')
  const since = RANGES[range] ? now - RANGES[range] : trends.startedAt || now - 300

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (!idsKey) {
      setData({})
      return
    }
    let stop = false
    const load = async () => {
      try {
        const sinceNow = RANGES[range] ? Date.now() / 1000 - RANGES[range] : trends.startedAt || Date.now() / 1000 - 300
        const res = await api.trendSeries(idsKey.split(',').map(Number), sinceNow, 360)
        if (!stop) setData(res)
      } catch {
        /* the next tick tries again */
      }
    }
    load()
    const t = setInterval(load, trends.running ? 2500 : 10000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [idsKey, range, trends.running, trends.startedAt])

  // charts: one per unit, at most eight series each; a point keeps its colour slot inside its chart
  const charts = useMemo(() => {
    const groups = new Map<string, { label: string; step: boolean; points: TrendPoint[] }>()
    for (const p of trends.points) {
      const g = groupOf(p)
      const entry = groups.get(g.key) ?? { label: g.label, step: g.step, points: [] }
      entry.points.push(p)
      groups.set(g.key, entry)
    }
    const out: { key: string; label: string; step: boolean; points: TrendPoint[] }[] = []
    for (const [key, g] of groups)
      for (let i = 0; i < g.points.length; i += 8)
        out.push({ key: `${key}:${i}`, label: g.points.length > 8 ? `${g.label} · ${i / 8 + 1}` : g.label, step: g.step, points: g.points.slice(i, i + 8) })
    return out
  }, [trends.points])
  const colorOf = useMemo(() => {
    const m = new Map<number, string>()
    for (const c of charts) c.points.forEach((p, i) => m.set(p.id, SERIES[i]))
    return m
  }, [charts])
  const seriesOf = (p: TrendPoint): ChartSeries['points'] => (data[String(p.id)] ?? []).map((b) => [b[0], b[1], b[4]])

  const sel = trends.points.find((p) => p.id === selected) ?? null

  const run = async (fn: () => Promise<TrendStatus>) => {
    setBusy(true)
    try {
      onTrends(await fn())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const download = (kind: 'xlsx' | 'csv') => {
    const a = document.createElement('a')
    a.href = `/api/trends/export?kind=${kind}`
    a.click()
  }

  const clock = trends.startedAt ? elapsed(trends.startedAt, trends.running ? now : trends.stoppedAt || now) : ''
  const count = trends.points.length
  const every = fmtInterval(Number(interval))
  const nextIn = trends.running && trends.nextRead ? Math.max(0, trends.nextRead - now) : 0

  return (
    <>
      <Pane side="left">
      <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
        <div className="px-4 pt-[18px] pb-2.5">
          <div className="text-[11px] text-(--text-faint)">BACon</div>
          <div className="text-[16px] font-medium tracking-[-0.01em]">Trends</div>
        </div>

        <div className="flex h-8 items-center gap-0.5 pr-2 pl-4 text-[12px] text-(--text-muted)">
          <span className="flex-1">
            Points{count ? <span className="ml-1.5 tabular-nums text-(--text-faint)">{count}</span> : null}
          </span>
          <Button aria-label="Add points" title="Add points" variant="ghost" size="icon-xs" onClick={() => setAdding(true)}>
            <Plus />
          </Button>
          <Menu>
            <MenuTrigger render={<Button aria-label="Trend options" variant="ghost" size="icon-xs" />}>
              <MoreHorizontal />
            </MenuTrigger>
            <MenuPopup align="end" className="w-56">
              <MenuItem onClick={onGoToObjects}>
                <ArrowRight />
                Go to Objects
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                disabled={!count}
                onClick={() => {
                  if (trends.running) toast('Stop recording first.', { kind: 'error' })
                  else run(api.trendClear)
                }}
              >
                <Trash2 />
                Clear points and samples
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>

        <ScrollArea scrollFade className="min-h-0 flex-1">
          <div className="flex flex-col gap-px px-2 pb-3">
            {trends.points.map((p) => (
              <button
                key={p.id}
                onClick={() => setSelected((s) => (s === p.id ? null : p.id))}
                data-active={selected === p.id ? 'true' : undefined}
                className="group/pt flex h-[52px] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] data-[active=true]:bg-(--paper-3)"
              >
                <span className="h-7 w-[3px] shrink-0 rounded-full" style={{ background: colorOf.get(p.id) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium">{p.name}</span>
                  <span className="mt-0.5 flex items-center gap-1">
                    <MethodPill p={p} />
                    <span className="truncate text-[11.5px] text-(--text-muted)">{p.deviceName}</span>
                  </span>
                </span>
                <span key={p.last} className="nc-text-swap shrink-0 text-right">
                  <span className="block text-[14px] font-medium tabular-nums">{p.last || '–'}</span>
                  {p.units && p.units !== 'no-units' ? <span className="block text-[11px] text-(--text-muted)">{p.units}</span> : null}
                </span>
              </button>
            ))}
            {!count ? <EmptyPoints /> : null}
          </div>
        </ScrollArea>
      </aside>
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-3 pl-2 text-[13px] text-(--text-muted)">
          <PaneToggle side="left" />
          <span>Trends</span>
          {trends.points.length ? (
            <>
              <ArrowRight className="size-3 text-(--ink-4)" />
              <span className="font-medium text-(--text-strong)">{trends.running ? 'Recording' : trends.samples ? 'Recorded session' : 'New session'}</span>
            </>
          ) : null}
          <span className="flex-1" />
          {sel ? <PaneToggle side="right" /> : null}
        </header>
        <div className="flex min-h-0 flex-1 gap-[10px] px-3 pb-3">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
            <div className="flex items-center gap-3 px-[18px] pt-[18px] pb-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">Trends</h1>
                {!count ? <div className="mt-1 text-[12px] text-(--text-muted)">Add points, then start recording.</div> : null}
              </div>
              {trends.samples ? (
                <Menu>
                  <MenuTrigger render={<Button size="sm" variant="white" />}>
                    Export
                    <ChevronDown />
                  </MenuTrigger>
                  <MenuPopup align="end" className="w-56">
                    <MenuItem onClick={() => download('xlsx')}>
                      <FileSpreadsheet />
                      Excel workbook
                    </MenuItem>
                    <MenuItem onClick={() => download('csv')}>
                      <FileText />
                      CSV file
                    </MenuItem>
                  </MenuPopup>
                </Menu>
              ) : null}
              {count ? (
                <Recorder
                  running={trends.running}
                  clock={clock || '0:00'}
                  samples={trends.samples}
                  resumable={!!trends.samples}
                  connected={status.connected}
                  label={`${mode === 'auto' ? 'On change' : 'On a timer'} · ${every}`}
                  next={nextIn ? `next ${elapsed(0, nextIn)}` : ''}
                  busy={busy}
                  onStart={() => run(() => api.trendStart(Number(interval), mode))}
                  onStop={() => run(api.trendStop)}
                  settings={
                    <RecordSettings mode={mode} interval={Number(interval)} locked={trends.running} onMode={setMode} onInterval={(sec) => setIntervalS(String(sec))} />
                  }
                />
              ) : null}
            </div>
            {count ? (
              <div className="flex items-center border-b border-(--border-subtle) px-[18px] pb-3">
                <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
                  <TabsList>
                    {(Object.keys(RANGES) as Range[]).map((k) => (
                      <TabsTab key={k} value={k}>
                        {RANGE_LABEL[k]}
                      </TabsTab>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
            ) : null}
            <ScrollArea scrollFade className="min-h-0 flex-1">
              {charts.length ? (
                <div className="flex flex-col gap-3 px-[18px] py-4">
                  {charts.map((c) => (
                    <div key={c.key} className="rounded-[14px] border border-(--border-subtle) p-4">
                      <div className="mb-2 text-[13px] font-medium">{c.label}</div>
                      <TrendChart
                        series={c.points.map((p) => ({ id: String(p.id), name: p.name, color: colorOf.get(p.id) ?? SERIES[0], points: seriesOf(p), hold: p.method === 'cov' || c.step }))}
                        holdUntil={trends.running ? now : trends.stoppedAt || undefined}
                        t0={since}
                        t1={now}
                        step={c.step}
                        unit={c.label}
                        empty={trends.running ? 'Waiting for the first values…' : 'Start recording to draw this chart.'}
                      />
                      {/* the legend doubles as the table view: every series' numbers are always readable */}
                      <div className="mt-3 overflow-hidden rounded-[10px] bg-(--surface-card-muted)">
                        <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_72px_72px] gap-3 px-3 py-1.5 text-[11.5px] text-(--text-muted)">
                          <span>Point</span>
                          <span className="text-right">Now</span>
                          <span className="text-right">Min</span>
                          <span className="text-right">Avg</span>
                          <span className="text-right">Max</span>
                        </div>
                        {c.points.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setSelected(p.id)}
                            className="grid w-full grid-cols-[minmax(0,1fr)_72px_72px_72px_72px] items-center gap-3 border-t border-(--border-divider) px-3 py-2 text-left text-[12.5px] hover:bg-(--surface-hover)"
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="h-[2px] w-3 shrink-0 rounded-full" style={{ background: colorOf.get(p.id) }} />
                              <span className="truncate">{p.name}</span>
                            </span>
                            <span className="text-right font-medium tabular-nums">{p.last || '–'}</span>
                            <span className="text-right tabular-nums text-(--text-muted)">{num(p.min)}</span>
                            <span className="text-right tabular-nums text-(--text-muted)">{num(p.avg)}</span>
                            <span className="text-right tabular-nums text-(--text-muted)">{num(p.max)}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="nc-view-in mx-auto flex max-w-[380px] flex-col items-center px-5 py-16 text-center">
                  <div className="text-[15px] font-medium">Nothing to trend yet</div>
                  <div className="mt-1 text-[13px] leading-normal text-(--text-muted)">
                    Add points by device, object type, or a query such as units = degrees-celsius, then start recording.
                  </div>
                  <Button size="sm" className="mt-4" onClick={() => setAdding(true)}>
                    <Plus />
                    Add points
                  </Button>
                </div>
              )}
            </ScrollArea>
          </section>

          {sel ? (
            <Pane side="right" gap={10}>
            <aside className="nc-view-in flex w-full min-w-0 flex-col gap-3">
              <div className="relative overflow-hidden rounded-2xl bg-[#292929] p-4 text-white">
                <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full bg-[radial-gradient(circle,rgba(131,231,238,.25),transparent_65%)]" />
                <div className="relative flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] text-white/60">
                      {sel.deviceName} · #{sel.instance}
                    </div>
                    <div className="mt-0.5 truncate text-[15px] font-medium">{sel.name}</div>
                  </div>
                  <button aria-label="Close" onClick={() => setSelected(null)} className="inline-flex size-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white">
                    <XIcon className="size-3.5" />
                  </button>
                </div>
                <div className="relative mt-4 flex items-baseline gap-2">
                  <span key={sel.last} className="nc-text-swap text-[34px] leading-none font-medium tracking-[-0.02em] tabular-nums">
                    {sel.last || '–'}
                  </span>
                  {sel.units && sel.units !== 'no-units' ? <span className="text-[13px] text-white/60">{sel.units}</span> : null}
                </div>
                <div className="relative mt-3">
                  <Sparkline points={seriesOf(sel)} />
                </div>
                <div className="relative mt-2 flex items-center justify-between text-[11.5px] text-white/60">
                  <MethodPill p={sel} dark />
                  <span>Updated {ago(sel.lastT)}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Samples', sel.samples.toLocaleString()],
                  ['Min', num(sel.min)],
                  ['Average', num(sel.avg)],
                  ['Max', num(sel.max)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-[12px] border border-(--border-subtle) bg-(--surface-card) px-3 py-2.5">
                    <div className="text-[11px] text-(--text-faint)">{k}</div>
                    <div className="mt-0.5 text-[14px] font-medium tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              {sel.method === 'error' ? <div className="rounded-[12px] bg-(--status-alarm-bg) px-3 py-2.5 text-[12.5px]">Could not read: {sel.error}</div> : null}
              {sel.method === 'poll' && sel.note ? (
                <div className="rounded-[12px] bg-(--surface-card-muted) px-3 py-2.5 text-[12.5px] text-(--text-muted)">The controller refused COV ({sel.note}), so this point is polled.</div>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => onShowInObjects(sel)}>
                  Show in Objects
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    run(() => api.trendRemove(sel.id))
                    setSelected(null)
                  }}
                >
                  Stop trending
                </Button>
              </div>
            </aside>
            </Pane>
          ) : null}
        </div>
      </main>
      <AddPointsSheet open={adding} onOpenChange={setAdding} rows={allRows} devices={devices} trendedKeys={trendedKeys} onAdd={onAddRows} />
    </>
  )
}
