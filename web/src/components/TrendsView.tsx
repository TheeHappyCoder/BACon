import { useEffect, useMemo, useState } from 'react'
import { api, type Bucket, type Device, type ObjectRow, type Status, type TrendPoint, type TrendStatus } from '../api'
import { AddPointsSheet } from './AddPointsSheet'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { ScrollArea } from '../ui/components/scroll-area'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { cn } from '../ui/utils'
import { SERIES, TrendChart, type ChartSeries } from './TrendChart'
import { Pane, PaneToggle } from './Layout'
import { useToast } from './Toasts'

const { MoreHorizontal, FileSpreadsheet, FileText, Trash2, XIcon, ArrowRight, ChevronDown, Plus } = Hugeicons

const RANGES = { '5m': 300, '15m': 900, '1h': 3600, all: 0 } as const
type Range = keyof typeof RANGES
const INTERVALS = [
  { value: '2', label: '2 s' },
  { value: '5', label: '5 s' },
  { value: '10', label: '10 s' },
  { value: '30', label: '30 s' },
  { value: '60', label: '1 min' },
]

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
  const [range, setRange] = useState<Range>('15m')
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

  const statusDot = trends.running ? 'bg-(--status-ok-strong)' : trends.samples ? 'bg-(--ink-4)' : 'bg-(--ink-4)'
  const statusText = trends.running ? 'Recording' : trends.samples ? 'Stopped' : 'Ready'
  const clock = trends.startedAt ? elapsed(trends.startedAt, trends.running ? now : trends.stoppedAt || now) : '0:00'

  return (
    <>
      <Pane side="left">
      <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
        <div className="px-4 pt-[18px] pb-2.5">
          <div className="text-[11px] text-(--text-faint)">BACon</div>
          <div className="text-[16px] font-medium tracking-[-0.01em]">Trends</div>
        </div>

        <div className="mx-3 mb-3 flex flex-col gap-2.5 rounded-[14px] border border-(--border-subtle) bg-(--surface-card) p-3 shadow-(--shadow-sheet)">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex size-2">
              {trends.running ? <span className="nc-ping absolute inset-0 rounded-full bg-(--status-ok-strong)" /> : null}
              <span className={cn('relative inline-flex size-2 rounded-full', statusDot)} />
            </span>
            <span className="text-[13px] font-medium">{statusText}</span>
            <span className="ml-auto text-[13px] tabular-nums text-(--text-muted)">{clock}</span>
          </div>
          {/* how it records, then how often: a timer only applies to what is polled */}
          <Tabs value={mode} onValueChange={(v) => !trends.running && setMode(v as string)}>
            <TabsList className="w-full">
              <TabsTab value="auto" className="flex-1" disabled={trends.running && mode !== 'auto'}>
                On change
              </TabsTab>
              <TabsTab value="poll" className="flex-1" disabled={trends.running && mode !== 'poll'}>
                On a timer
              </TabsTab>
            </TabsList>
          </Tabs>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] text-(--text-muted)">{mode === 'auto' ? 'Points without COV, every' : 'Read every point every'}</span>
            <Select value={interval} onValueChange={(v) => setIntervalS(v as string)} items={INTERVALS} disabled={trends.running}>
              <SelectTrigger size="sm" className="w-[92px] min-w-0 text-[12.5px]">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {INTERVALS.map((i) => (
                  <SelectItem key={i.value} value={i.value}>
                    {i.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
          {trends.running ? (
            <Button size="sm" variant="ink" loading={busy} onClick={() => run(api.trendStop)}>
              Stop recording
            </Button>
          ) : (
            <Button size="sm" loading={busy} disabled={!trends.points.length || !status.connected} onClick={() => run(() => api.trendStart(Number(interval), mode))}>
              {trends.samples ? 'Resume recording' : 'Start recording'}
            </Button>
          )}
          <span className="text-[11.5px] leading-snug text-(--text-muted)">
            {!status.connected
              ? 'Connect to a network to record.'
              : mode === 'auto'
                ? 'Each change is recorded the moment the controller sends it. Read-only.'
                : 'Every point is read on the timer, batched per controller. Read-only.'}
          </span>
        </div>

        <div className="flex items-center gap-1 px-4 pb-1.5 text-[12px] text-(--text-muted)">
          <span className="flex-1">Points</span>
          <Button size="xs" variant="white" onClick={() => setAdding(true)}>
            <Plus />
            Add points
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
                disabled={!trends.points.length}
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
            {!trends.points.length ? (
              <div className="mx-1 mt-1 rounded-[12px] border border-dashed border-(--border-default) px-3 py-4 text-center">
                <div className="text-[13px] font-medium">No points yet</div>
                <div className="mt-1 text-[12px] leading-snug text-(--text-muted)">Pick them by device, object type, or a query.</div>
                <Button size="xs" className="mt-3" onClick={() => setAdding(true)}>
                  Add points
                </Button>
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-3 pl-2 text-[13px] text-(--text-muted)">
          <PaneToggle side="left" />
          <span>Trends</span>
          {trends.file ? (
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
            <div className="flex items-start gap-4 px-[18px] pt-[18px] pb-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">Trends</h1>
                <div className="mt-1 text-[12px] text-(--text-muted)">
                  {trends.startedAt
                    ? `${trends.running ? 'Recording' : 'Recorded'} from ${new Date(trends.startedAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${trends.samples.toLocaleString()} samples`
                    : 'Add points, then start recording.'}
                </div>
              </div>
              <Menu>
                <MenuTrigger render={<Button size="sm" disabled={!trends.samples} />}>
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
            </div>
            {trends.points.length ? (
              <div className="flex items-center border-b border-(--border-subtle) px-[18px] pb-3">
                <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
                  <TabsList>
                    <TabsTab value="5m">5 min</TabsTab>
                    <TabsTab value="15m">15 min</TabsTab>
                    <TabsTab value="1h">1 hour</TabsTab>
                    <TabsTab value="all">All</TabsTab>
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
