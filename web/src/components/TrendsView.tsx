import { useEffect, useMemo, useState } from 'react'
import { api, type Bucket, type Device, type ObjectRow, type Status, type TrendPoint, type TrendStats, type TrendStatus } from '../api'
import { AddPointsSheet } from './AddPointsSheet'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { ScrollArea } from '../ui/components/scroll-area'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'
import { GroupDialog, howItRecords } from './TrendGroupDialog'
import { TrendLanes, isBinary, isStates } from './TrendLanes'
import { Pane, PaneToggle } from './Layout'
import { useToast } from './Toasts'

const { LineChart, Plus, Play, FileSpreadsheet, FileText, Trash2, Settings2, MoreHorizontal } = Hugeicons

const RANGES = { '15m': 900, '1h': 3600, '6h': 21600, '24h': 86400, '7d': 604800, all: 0 } as const
type Range = keyof typeof RANGES
const RANGE_LABEL: Record<Range, string> = { '15m': '15 min', '1h': '1 hour', '6h': '6 hours', '24h': '24 hours', '7d': '7 days', all: 'All' }
const SELECTED = 'bx.trendGroup'
const ACTIVE = new Set(['active', 'true', '1', 'on'])

function clockOf(from: number, to: number) {
  const s = Math.max(0, Math.round(to - from))
  const p = (n: number) => String(n).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`
}

export function TrendsView({
  status,
  trends,
  onTrends,
  onShowInObjects,
  onGoToObjects,
  allRows,
  devices,
}: {
  allRows: ObjectRow[]
  devices: Device[]
  status: Status
  trends: TrendStatus
  onTrends: (t: TrendStatus) => void
  onShowInObjects: (p: TrendPoint) => void
  onGoToObjects: () => void
}) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState<number | null>(() => Number(localStorage.getItem(SELECTED)) || null)
  const group = trends.groups.find((g) => g.id === selectedId) ?? trends.groups[0] ?? null
  useEffect(() => {
    if (group) localStorage.setItem(SELECTED, String(group.id))
  }, [group])
  const [range, setRange] = useState<Range>('1h')
  const [now, setNow] = useState(() => Date.now() / 1000)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [data, setData] = useState<Record<string, Bucket[]>>({})
  const [stats, setStats] = useState<Record<string, TrendStats>>({})

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000)
    return () => clearInterval(t)
  }, [])

  const byId = useMemo(() => new Map(trends.points.map((p) => [p.id, p])), [trends.points])
  const points = useMemo(() => (group ? group.pointIds.map((i) => byId.get(i)).filter((p): p is TrendPoint => !!p) : []), [group, byId])
  const idsKey = points.map((p) => p.id).join(',')
  const logsLoading = points.filter((p) => p.log?.state === 'loading').length
  const since = RANGES[range] ? now - RANGES[range] : trends.earliest || now - 3600
  const sinceKey = RANGES[range] ? range : `all:${trends.earliest}`

  // the lanes and their numbers for the group on screen; faster while it records
  useEffect(() => {
    let stop = false
    const load = async () => {
      if (!idsKey) {
        setData({})
        setStats({})
        return
      }
      const ids = idsKey.split(',').map(Number)
      const from = RANGES[range] ? Date.now() / 1000 - RANGES[range] : trends.earliest || Date.now() / 1000 - 3600
      try {
        const [series, st] = await Promise.all([api.trendSeries(ids, from, 400), api.trendStats(ids, from)])
        if (!stop) {
          setData(series)
          setStats(st)
        }
      } catch {
        /* the next tick tries again */
      }
    }
    const first = setTimeout(load, 0)
    const t = setInterval(load, group?.running ? 3000 : 15000)
    return () => {
      stop = true
      clearTimeout(first)
      clearInterval(t)
    }
  }, [idsKey, sinceKey, group?.running, logsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (fn: () => Promise<typeof trends>) => {
    setBusy(true)
    try {
      onTrends(await fn())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  // states and on/off in the words the controller uses for them, from the last read of the object
  const rowOf = useMemo(() => new Map(allRows.map((r) => [r.key, r])), [allRows])
  const labelOf = (p: TrendPoint, text: string) => {
    const row = rowOf.get(`${p.device}:${p.typeId},${p.instance}`)
    if (!row) return text
    if (isStates(p) && row.values['state-text']) return row.values['state-text'].split('; ')[Number(text) - 1] || text
    if (isBinary(p)) return (ACTIVE.has(text.toLowerCase()) ? row.values['active-text'] : row.values['inactive-text']) || text
    return text
  }

  // the time line starts where the data does, so a group recording for ten minutes is not a lane of empty hour
  const firstData = useMemo(() => {
    let first = Infinity
    for (const list of Object.values(data)) if (list.length) first = Math.min(first, list[0][0])
    return first
  }, [data])
  const laneStart = Number.isFinite(firstData) && firstData > since ? Math.max(since, firstData - Math.max(30, (now - firstData) * 0.04)) : since

  const problems = points.filter((p) => p.method === 'error' || p.log?.state === 'error' || p.log?.state === 'unsupported')
  const devicesIn = new Set(points.map((p) => p.device)).size
  const groupKeys = useMemo(() => new Set(points.map((p) => `${p.device}:${p.typeId},${p.instance}`)), [points])

  const download = (kind: 'xlsx' | 'csv') => {
    if (!group) return
    const a = document.createElement('a')
    a.href = `/api/trends/export?kind=${kind}&group=${group.id}&since=${RANGES[range] ? Math.floor(since) : 0}`
    a.click()
  }

  const dialogs = (
    <>
      {creating ? (
        <GroupDialog
          open
          onOpenChange={setCreating}
          onSave={async (v) => {
            const res = await api.trendGroupCreate(v.name, v.interval, v.mode)
            onTrends(res)
            setSelectedId(res.group)
            setAdding(true)
          }}
        />
      ) : null}
      {editing && group ? <GroupDialog open onOpenChange={setEditing} group={group} onSave={async (v) => onTrends(await api.trendGroupUpdate(group.id, v))} /> : null}
      {group ? (
        <AddPointsSheet
          open={adding}
          onOpenChange={setAdding}
          rows={allRows}
          devices={devices}
          trendedKeys={groupKeys}
          onAdd={async (rows) => {
            try {
              const res = await api.trendGroupAdd(group.id, rows)
              onTrends(res)
              toast(res.added.length ? `Added ${res.added.length} point${res.added.length === 1 ? '' : 's'} to ${group.name}` : `Those points are already in ${group.name}`)
            } catch (e) {
              toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
            }
          }}
        />
      ) : null}
    </>
  )

  // ---- the groups ----
  const list = (
    <Pane side="left">
      <aside className="flex w-full min-w-0 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
          <span className="flex-1 text-[12px] font-medium tracking-[0.01em] text-(--text-muted)">
            Trend groups{trends.groups.length ? <span className="ml-1.5 font-normal tabular-nums text-(--text-faint)">{trends.groups.length}</span> : null}
          </span>
          <Tooltip>
            <TooltipTrigger render={<Button aria-label="New trend group" variant="ghost" size="icon-xs" onClick={() => setCreating(true)} />}>
              <Plus />
            </TooltipTrigger>
            <TooltipPopup>New trend group</TooltipPopup>
          </Tooltip>
        </div>
        <ScrollArea scrollFade className="min-h-0 flex-1">
          <div className="flex flex-col gap-0.5 px-2 pb-3">
            {trends.groups.map((g) => {
              const on = group?.id === g.id
              return (
                <button
                  key={g.id}
                  onClick={() => setSelectedId(g.id)}
                  aria-current={on ? 'true' : undefined}
                  className={cn(
                    'flex h-[54px] items-center gap-2.5 rounded-[10px] px-2.5 text-left transition-colors',
                    on ? 'bg-(--surface-card) shadow-[0_0_0_1px_var(--border-subtle),0_2px_6px_-2px_rgba(0,0,0,.08)]' : 'hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]',
                  )}
                >
                  <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-4', on || g.running ? 'bg-(--ink) text-(--color-ns-green)' : 'bg-(--surface-card) text-(--text-muted) shadow-[0_0_0_1px_var(--border-subtle)]')}>
                    <LineChart />
                    {g.running ? (
                      <span className="absolute -top-0.5 -right-0.5 inline-flex size-2.5">
                        <span className="nc-ping absolute inset-0 rounded-full bg-(--color-ns-green)" />
                        <span className="relative size-2.5 rounded-full border-2 border-(--surface-page) bg-(--color-ns-green)" />
                      </span>
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13.5px] font-medium tracking-[-0.005em]">{g.name}</span>
                    <span className="truncate text-[11.5px] text-(--text-muted)">
                      {g.pointIds.length} point{g.pointIds.length === 1 ? '' : 's'} · {g.running ? `recording ${clockOf(g.startedAt, now)}` : howItRecords(g)}
                    </span>
                  </span>
                </button>
              )
            })}
            {!trends.groups.length ? (
              <div className="mx-1 mt-1 rounded-[12px] border border-dashed border-(--border-default) px-3 py-3 text-[12px] leading-snug text-(--text-muted)">Groups you make show up here, each with its own interval.</div>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
    </Pane>
  )

  if (!group) {
    return (
      <>
        {dialogs}
        {list}
        <main className="flex min-w-0 flex-1 flex-col items-center justify-center">
          <div className="nc-view-in flex max-w-[440px] flex-col items-center px-6 text-center">
            <span className="mb-4 flex size-14 items-center justify-center rounded-[16px] bg-(--ink) text-(--color-ns-green) shadow-[0_8px_20px_-10px_rgba(0,0,0,.5)] [&_svg]:size-6">
              <LineChart />
            </span>
            <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">Trend what belongs together</h1>
            <p className="m-0 mt-1.5 text-[13px] leading-normal text-(--text-muted)">
              Make a group for a chiller, an AHU or a floor, give it the interval it needs, and add its points. Each group records on its own and shows every point on one time line.
            </p>
            <div className="mt-5 flex gap-2">
              <Button onClick={() => setCreating(true)}>
                <Plus />
                New trend group
              </Button>
              <Button variant="secondary" onClick={onGoToObjects}>
                Pick points in Objects
              </Button>
            </div>
          </div>
        </main>
      </>
    )
  }

  const facts = [
    `${points.length} point${points.length === 1 ? '' : 's'}${devicesIn > 1 ? ` on ${devicesIn} devices` : points[0] ? ` on ${points[0].deviceName}` : ''}`,
    `records ${howItRecords(group)}`,
    group.samples ? `${group.samples.toLocaleString()} samples` : '',
  ].filter(Boolean)

  return (
    <>
      {dialogs}
      {list}
      <main className="flex min-w-0 flex-1 flex-col">
        <div key={group.id} className="nc-view-in flex min-h-0 flex-1 flex-col">
          {/* the group: what it is, and one button for what it does */}
          <header className="flex shrink-0 items-center gap-3.5 px-6 pt-5 pb-4">
            <span className="-mr-1 -ml-2.5">
              <PaneToggle side="left" />
            </span>
            <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-(--ink) text-(--color-ns-green) shadow-[0_6px_16px_-8px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.08)] [&_svg]:size-[22px]">
              <LineChart />
              <span className={cn('absolute -right-1 -bottom-1 size-3.5 rounded-full border-[2.5px] border-(--surface-card)', group.running ? 'bg-(--color-ns-green)' : problems.length ? 'bg-(--status-alarm-strong)' : 'bg-(--ink-4)')} />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="m-0 truncate text-[22px] leading-7 font-medium tracking-[-0.02em]">{group.name}</h1>
              <div className="mt-0.5 truncate text-[12.5px] text-(--text-muted)">{facts.join(' · ')}</div>
            </div>
            {group.running ? (
              <button
                onClick={() => run(() => api.trendGroupStop(group.id))}
                disabled={busy}
                title="Stop recording"
                className="flex h-9 shrink-0 items-center gap-2.5 rounded-full bg-(--pill-dark) pr-1 pl-3.5 text-[13px] text-white transition-colors hover:bg-(--pill-dark-2)"
              >
                <span className="relative inline-flex size-2">
                  <span className="nc-ping absolute inset-0 rounded-full bg-(--color-ns-green)" />
                  <span className="relative inline-flex size-2 rounded-full bg-(--color-ns-green)" />
                </span>
                <span className="font-medium tabular-nums">Recording {clockOf(group.startedAt, now)}</span>
                <span className="flex h-7 items-center gap-1.5 rounded-full bg-white/12 px-3 font-medium">
                  <span className="size-2.5 rounded-[3px] bg-white" />
                  Stop
                </span>
              </button>
            ) : (
              <Button
                className="shrink-0"
                loading={busy}
                disabled={!status.connected || !points.length}
                title={!status.connected ? 'Connect to a network first' : !points.length ? 'Add points first' : undefined}
                onClick={() => run(() => api.trendGroupStart(group.id))}
              >
                <Play />
                {group.samples ? 'Resume recording' : 'Start recording'}
              </Button>
            )}
            <Menu>
              <MenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Group actions" />}>
                <MoreHorizontal />
              </MenuTrigger>
              <MenuPopup align="end" className="w-60">
                <MenuItem onClick={() => setEditing(true)}>
                  <Settings2 />
                  Name and interval…
                </MenuItem>
                <MenuSeparator />
                <MenuItem disabled={!group.samples} onClick={() => download('xlsx')}>
                  <FileSpreadsheet />
                  Export {RANGE_LABEL[range].toLowerCase()} to Excel
                </MenuItem>
                <MenuItem disabled={!group.samples} onClick={() => download('csv')}>
                  <FileText />
                  Export {RANGE_LABEL[range].toLowerCase()} to CSV
                </MenuItem>
                <MenuSeparator />
                <MenuItem
                  variant="destructive"
                  onClick={() => {
                    const gone = group.id
                    run(() => api.trendGroupDelete(gone))
                    setSelectedId(null)
                  }}
                >
                  <Trash2 />
                  Delete group
                </MenuItem>
              </MenuPopup>
            </Menu>
          </header>

          {!points.length ? (
            <div className="mx-6 mb-6 flex flex-col items-center rounded-[16px] border border-dashed border-(--border-default) px-6 py-14 text-center">
              <div className="text-[15px] font-medium">No points in {group.name} yet</div>
              <div className="mt-1 max-w-[380px] text-[13px] leading-normal text-(--text-muted)">Add them here, or tick rows in Objects and choose Trend. A point can be in several groups; it is read once.</div>
              <div className="mt-4 flex gap-2">
                <Button size="sm" onClick={() => setAdding(true)}>
                  <Plus />
                  Add points
                </Button>
                <Button size="sm" variant="secondary" onClick={onGoToObjects}>
                  Go to Objects
                </Button>
              </div>
            </div>
          ) : (
            <>
              {/* the time line's controls */}
              <div className="flex shrink-0 items-center gap-3 px-6 pb-3">
                <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
                  <TabsList>
                    {(Object.keys(RANGES) as Range[]).map((r) => (
                      <TabsTab key={r} value={r}>
                        {RANGE_LABEL[r]}
                      </TabsTab>
                    ))}
                  </TabsList>
                </Tabs>
                {problems.length ? (
                  <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-(--status-alarm-bg) px-3 text-[12.5px]" title={problems.map((p) => p.name).join(', ')}>
                    <span className="size-1.5 rounded-full bg-(--status-alarm-strong)" />
                    {problems.length} not answering
                  </span>
                ) : null}
                <span className="flex-1" />
                <span className="text-[12px] text-(--text-faint)">
                  Hover to read every point at one moment
                </span>
                <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
                  <Plus />
                  Add points
                </Button>
              </div>
              <ScrollArea scrollFade scrollFadeSides={{ top: false, left: false }} className="min-h-0 flex-1 border-t border-(--border-subtle)">
                <TrendLanes
                  points={points}
                  data={data}
                  stats={stats}
                  t0={laneStart}
                  t1={now}
                  hold={group.running}
                  labelOf={labelOf}
                  onShow={onShowInObjects}
                  onRemove={(p) => run(() => api.trendGroupRemove(group.id, p.id))}
                  onSync={(p) => run(() => api.trendSync(p.id))}
                />
              </ScrollArea>
            </>
          )}
        </div>
      </main>
    </>
  )
}
