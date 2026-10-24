import { useEffect, useMemo, useState } from 'react'
import type { Device, ObjectRow, Status } from '../api'
import { TRANSITION_LABEL, ago, clock, conditionText, isAlarmObject, notificationClassOf, stateLabel, stateOf, type AlarmState, type Live, type Severity } from '../alarms'
import { unitShort } from '../schedule'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { cn } from '../ui/utils'
import { Detail, EmptyState, Group, PaneSearch, PaneTitle } from './Inspector'
import { Pane, PaneToggle } from './Layout'
import { SPIN, useSpin } from './spin'

const { ArrowRight, Notification, CheckIcon, ReloadIcon, XIcon } = Hugeicons

type Filter = 'active' | 'alarm' | 'fault' | 'unacked' | 'all'
type Item = { row: ObjectRow; state: AlarmState; condition: string }

const BAR: Record<Severity, string> = { alarm: 'bg-(--status-alarm-strong)', fault: 'bg-(--status-warn-strong)', normal: 'bg-(--status-ok)' }
const CHIP: Record<Severity, string> = { alarm: 'bg-(--status-alarm)', fault: 'bg-(--status-warn)', normal: 'bg-(--status-ok-bg)' }
const RANK: Record<Severity, number> = { alarm: 0, fault: 1, normal: 2 }
const POLL_MS = 15_000

function StateChip({ state }: { state: AlarmState }) {
  return (
    <span className={cn('inline-flex h-[22px] shrink-0 items-center rounded-full px-2.5 text-[11.5px] leading-none whitespace-nowrap text-(--ink)', CHIP[state.severity])}>
      {stateLabel(state.eventState)}
    </span>
  )
}

function AckMark({ state }: { state: AlarmState }) {
  if (!state.unacked) return <CheckIcon aria-label="Acknowledged" className="size-3.5 text-(--text-faint)" />
  return (
    <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-(--border-default) px-2 text-[11.5px] whitespace-nowrap">
      <span className="size-1.5 rounded-full bg-(--status-warn-strong)" />
      Not acknowledged
    </span>
  )
}

const valueText = (r: ObjectRow) => {
  const v = r.values['present-value']
  if (v === undefined) return '–'
  if (v === 'active' && r.values['active-text']) return r.values['active-text']
  if (v === 'inactive' && r.values['inactive-text']) return r.values['inactive-text']
  const states = r.values['state-text']?.split('; ')
  if (states && /^\d+$/.test(v)) return states[Number(v) - 1] || v
  const u = unitShort(r.values.units ?? '')
  const n = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(v) ? String(Number(Number(v).toFixed(2))) : v
  return u ? `${n}${u.startsWith('°') || u === '%' ? '' : ' '}${u}` : n
}

export function AlarmsView({
  status,
  rows,
  devices,
  live,
  onCheck,
  onShowInObjects,
  onReread,
  onGoToObjects,
}: {
  status: Status
  rows: ObjectRow[]
  devices: Device[]
  live: Record<number, Live>
  /** ask the controllers for their alarm lists; reread: also read these objects again */
  onCheck: (devices: number[], reread: ObjectRow[]) => Promise<void>
  onShowInObjects: (row: ObjectRow) => void
  onReread: (row: ObjectRow) => Promise<void>
  onGoToObjects: () => void
}) {
  const [filter, setFilter] = useState<Filter>('active')
  const [search, setSearch] = useState('')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [checking, spinCheck] = useSpin()
  const [rereading, spinReread] = useSpin()
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const rowsByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const items = useMemo<Item[]>(
    () =>
      rows
        .filter(isAlarmObject)
        .map((row) => ({ row, state: stateOf(row, live[row.device]), condition: conditionText(row, rowsByKey) }))
        .sort((a, b) => RANK[a.state.severity] - RANK[b.state.severity] || Number(b.state.unacked) - Number(a.state.unacked) || (b.state.since ?? 0) - (a.state.since ?? 0)),
    [rows, live, rowsByKey],
  )
  const alarmDevices = useMemo(() => [...new Set(items.map((i) => i.row.device))], [items])
  const counts = {
    alarm: items.filter((i) => i.state.severity === 'alarm').length,
    fault: items.filter((i) => i.state.severity === 'fault').length,
    unacked: items.filter((i) => i.state.unacked).length,
    all: items.length,
  }
  const active = counts.alarm + counts.fault

  // while the page is open, ask the controllers for their alarm lists every 15 s: one small request per device
  const devicesKey = alarmDevices.join(',')
  useEffect(() => {
    if (!status.connected || !devicesKey) return
    const ids = devicesKey.split(',').map(Number)
    onCheck(ids, [])
    const t = setInterval(() => onCheck(ids, []), POLL_MS)
    return () => clearInterval(t)
  }, [status.connected, devicesKey, onCheck])

  const shown = items.filter((i) => {
    const q = search.trim().toLowerCase()
    if (q && ![i.row.values['object-name'], i.row.values['Device name'], i.condition, stateLabel(i.state.eventState)].some((v) => (v ?? '').toLowerCase().includes(q))) return false
    if (filter === 'active') return i.state.severity !== 'normal' || i.state.unacked
    if (filter === 'alarm') return i.state.severity === 'alarm'
    if (filter === 'fault') return i.state.severity === 'fault'
    if (filter === 'unacked') return i.state.unacked
    return true
  })
  const selected = items.find((i) => i.row.key === selectedKey) ?? null
  const multiDevice = alarmDevices.length > 1
  const lives = alarmDevices.map((d) => live[d]).filter(Boolean)
  const checkedAt = lives.length ? Math.min(...lives.map((l) => l.at * 1000)) : 0
  const failed = alarmDevices.filter((d) => live[d]?.error)
  const deviceName = (inst: number) => devices.find((d) => d.instance === inst)?.name || `Device ${inst}`

  const check = () =>
    spinCheck(() =>
      onCheck(
        alarmDevices,
        items.filter((i) => i.state.severity !== 'normal' || i.state.unacked).map((i) => i.row),
      ),
    )

  const sourceLine = !status.connected
    ? 'Offline: states from the last read'
    : !checkedAt
      ? 'Asking the controllers…'
      : failed.length === alarmDevices.length
        ? 'From the last read: the controllers do not answer alarm queries'
        : `Live from the controller${alarmDevices.length === 1 ? '' : 's'} · checked ${ago(checkedAt, now)}${failed.length ? ` · ${failed.length} device${failed.length === 1 ? '' : 's'} from the last read` : ''}`

  if (!items.length) {
    return (
      <>
        <Pane side="left">
          <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
            <PaneTitle title="Alarms" />
            <div className="mx-3 mt-1 rounded-[12px] border border-dashed border-(--border-default) px-3.5 py-3 text-[12.5px] leading-snug text-(--text-muted)">
              Objects with an alarm set up show up here once their device is read.
            </div>
          </aside>
        </Pane>
        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-3 pl-2 text-[13px] text-(--text-muted)">
            <PaneToggle side="left" />
            <span>Alarms</span>
          </header>
          <div className="flex min-h-0 flex-1 px-3 pb-3">
            <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
              <EmptyState
                icon={<Notification className="size-5" />}
                title="No alarms set up"
                text={
                  devices.length
                    ? 'None of the objects read so far reports alarms: no event-enable, limits or alarm values, and no Event Enrollment objects.'
                    : 'Read a device in Objects. Points with alarm limits or alarm values, and Event Enrollment objects, appear here with their state.'
                }
                action={
                  <Button size="sm" onClick={onGoToObjects}>
                    Go to Objects
                  </Button>
                }
              />
            </section>
          </div>
        </main>
      </>
    )
  }

  const tiles: { key: Filter; label: string; count: number; dot: string }[] = [
    { key: 'alarm', label: 'In alarm', count: counts.alarm, dot: 'bg-(--status-alarm-strong)' },
    { key: 'fault', label: 'Fault', count: counts.fault, dot: 'bg-(--status-warn-strong)' },
    { key: 'unacked', label: 'Not acknowledged', count: counts.unacked, dot: 'bg-(--status-warn)' },
    { key: 'all', label: 'Set up', count: counts.all, dot: 'bg-(--ink-4)' },
  ]
  // the condition column (and the device, with several) only shows when the table is wide enough
  const grid = multiDevice
    ? 'grid-cols-[112px_minmax(150px,1.6fr)_88px_100px_152px] @[860px]:grid-cols-[112px_minmax(170px,1.6fr)_minmax(110px,1fr)_96px_minmax(160px,1.4fr)_110px_150px]'
    : 'grid-cols-[112px_minmax(150px,1.6fr)_88px_100px_152px] @[760px]:grid-cols-[112px_minmax(170px,1.6fr)_96px_minmax(160px,1.4fr)_110px_150px]'
  const wide = multiDevice ? '@[860px]:block' : '@[760px]:block'

  return (
    <>
      <Pane side="left">
        <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
          <PaneTitle title="Alarms" count={items.length} />
          {items.length > 6 ? <PaneSearch value={search} onChange={setSearch} placeholder="Search alarms" /> : null}
          <ScrollArea scrollFade className="min-h-0 flex-1">
            <div className="flex flex-col gap-px px-2 pb-3">
              {items.map((i) => (
                <button
                  key={i.row.key}
                  onClick={() => setSelectedKey((k) => (k === i.row.key ? null : i.row.key))}
                  data-active={selectedKey === i.row.key ? 'true' : undefined}
                  className="flex h-[52px] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] data-[active=true]:bg-(--paper-3)"
                >
                  <span className={cn('h-7 w-[3px] shrink-0 rounded-full', BAR[i.state.severity], i.state.severity === 'normal' && 'opacity-60')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{i.row.values['object-name'] || i.row.key}</span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-(--text-muted)">
                      {i.state.severity === 'normal' ? i.condition : `${stateLabel(i.state.eventState)}${i.state.since ? ` · ${ago(i.state.since, now)}` : ''}`}
                    </span>
                  </span>
                  {i.state.unacked ? <span title="Not acknowledged" className="size-2 shrink-0 rounded-full bg-(--status-warn-strong)" /> : null}
                </button>
              ))}
            </div>
          </ScrollArea>
        </aside>
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-2 pl-2 text-[13px] text-(--text-muted)">
          <PaneToggle side="left" />
          <span>Alarms</span>
          {selected ? (
            <>
              <ArrowRight className="size-3 text-(--ink-4)" />
              <span className="truncate font-medium text-(--text-strong)">{selected.row.values['object-name']}</span>
            </>
          ) : null}
          <span className="flex-1" />
          {selected ? <PaneToggle side="right" /> : null}
        </header>
        <div className="flex min-h-0 flex-1 gap-[10px] px-3 pb-3">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
            <div className="flex items-start gap-3 px-[18px] pt-[18px] pb-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">{active ? `${active} active` : 'All normal'}</h1>
                <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px] text-(--text-muted)">
                  {status.connected && checkedAt && failed.length < alarmDevices.length ? (
                    <span className="relative inline-flex size-1.5 shrink-0">
                      <span className="nc-ping absolute inset-0 rounded-full bg-(--status-ok-strong)" />
                      <span className="relative inline-flex size-1.5 rounded-full bg-(--status-ok-strong)" />
                    </span>
                  ) : null}
                  <span className="truncate">{sourceLine}</span>
                </div>
              </div>
              <Button size="sm" variant="white" disabled={!status.connected || checking} title={status.connected ? undefined : 'Connect to check'} onClick={check}>
                <ReloadIcon className={checking ? SPIN : ''} />
                Check now
              </Button>
            </div>

            <div className="grid grid-cols-4 gap-2 px-[18px] pb-3.5">
              {tiles.map((t) => (
                <button
                  key={t.key}
                  aria-pressed={filter === t.key}
                  onClick={() => setFilter((f) => (f === t.key ? 'active' : t.key))}
                  className={cn(
                    'flex flex-col items-start rounded-[12px] border px-3 py-2.5 text-left transition-colors',
                    filter === t.key ? 'border-(--ink) bg-(--surface-card)' : 'border-(--border-subtle) bg-(--surface-card-muted) hover:border-(--border-strong)',
                  )}
                >
                  <span className="flex items-center gap-1.5 text-[11.5px] text-(--text-muted)">
                    <span className={cn('size-1.5 rounded-full', t.dot)} />
                    {t.label}
                  </span>
                  <span className="mt-0.5 text-[20px] leading-tight font-medium tabular-nums">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="mx-[18px] mb-[18px] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-(--border-subtle)">
              <div className="flex h-10 shrink-0 items-center gap-2 px-4 text-[12.5px]">
                <span className="font-medium">
                  {filter === 'active' ? 'Active and not acknowledged' : filter === 'all' ? 'Every alarm set up' : tiles.find((t) => t.key === filter)?.label}
                </span>
                <span className="rounded-full bg-(--surface-track) px-1.5 text-[11px] leading-[18px] tabular-nums text-(--text-muted)">{shown.length}</span>
                <span className="flex-1" />
                {filter !== 'active' ? (
                  <button onClick={() => setFilter('active')} className="inline-flex items-center gap-1 text-[12px] text-(--text-muted) hover:text-(--text-strong)">
                    <XIcon className="size-3" />
                    Show active
                  </button>
                ) : null}
              </div>
              <ScrollArea scrollFade scrollFadeSides={{ left: false, top: false }} className="min-h-0 flex-1">
                {shown.length ? (
                  <div className="@container min-w-[560px]">
                    <div className={cn('sticky top-0 z-[2] grid gap-3 border-t border-(--border-divider) bg-(--surface-card-muted) px-4 py-1.5 text-[11.5px] text-(--text-muted)', grid)}>
                      <span>State</span>
                      <span>Object</span>
                      {multiDevice ? <span className={cn('hidden', wide)}>Device</span> : null}
                      <span className="text-right">Value</span>
                      <span className={cn('hidden', wide)}>Alarm when</span>
                      <span>Since</span>
                      <span>Acknowledged</span>
                    </div>
                    {shown.map((i) => (
                      <button
                        key={i.row.key}
                        onClick={() => setSelectedKey((k) => (k === i.row.key ? null : i.row.key))}
                        data-active={selectedKey === i.row.key ? 'true' : undefined}
                        className={cn('grid h-[52px] w-full items-center gap-3 border-t border-(--border-divider) px-4 text-left text-[12.5px] transition-colors hover:bg-(--surface-hover) data-[active=true]:bg-(--surface-checked)', grid)}
                      >
                        <span>
                          <StateChip state={i.state} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{i.row.values['object-name'] || i.row.key}</span>
                          <span className="block truncate text-[11.5px] text-(--text-muted)">
                            {i.row.values['Object type']} {i.row.instance}
                          </span>
                        </span>
                        {multiDevice ? <span className={cn('hidden truncate text-(--text-muted)', wide)}>{deviceName(i.row.device)}</span> : null}
                        <span className="truncate text-right font-medium tabular-nums">{valueText(i.row)}</span>
                        <span className={cn('hidden truncate text-(--text-muted)', wide)}>{i.condition}</span>
                        <span className="min-w-0">
                          {i.state.since ? (
                            <>
                              <span className="block truncate tabular-nums">{clock(i.state.since)}</span>
                              <span className="block truncate text-[11.5px] text-(--text-muted)">{ago(i.state.since, now)}</span>
                            </>
                          ) : (
                            <span className="text-(--text-faint)">–</span>
                          )}
                        </span>
                        <span>
                          <AckMark state={i.state} />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <EmptyState
                    title={filter === 'active' ? 'Nothing in alarm' : 'Nothing here'}
                    text={
                      filter === 'active'
                        ? `All ${items.length} object${items.length === 1 ? '' : 's'} with an alarm set up ${items.length === 1 ? 'is' : 'are'} normal and acknowledged.`
                        : 'No alarm objects match this filter.'
                    }
                    action={
                      filter === 'active' ? (
                        <Button size="sm" variant="secondary" onClick={() => setFilter('all')}>
                          Show every alarm set up
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </ScrollArea>
            </div>
          </section>

          {selected ? (
            <Pane side="right" gap={10}>
              <ScrollArea scrollFade className="min-h-0 w-full">
                <aside key={selected.row.key} className="nc-view-in flex w-full min-w-0 flex-col gap-2.5 pb-1">
                  <AlarmCard item={selected} now={now} onClose={() => setSelectedKey(null)} deviceName={deviceName(selected.row.device)} />
                  <Setup row={selected.row} condition={selected.condition} />
                  <NotificationClass row={selected.row} rows={rows} />
                  <History state={selected.state} />
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" onClick={() => onShowInObjects(selected.row)}>
                      Show in Objects
                    </Button>
                    <Button size="sm" variant="white" disabled={!status.connected || rereading} onClick={() => spinReread(() => onReread(selected.row))}>
                      <ReloadIcon className={rereading ? SPIN : ''} />
                      Read again
                    </Button>
                  </div>
                </aside>
              </ScrollArea>
            </Pane>
          ) : null}
        </div>
      </main>
    </>
  )
}

const GLOW: Record<Severity, string> = { alarm: 'rgba(255,185,162,.32)', fault: 'rgba(249,235,87,.26)', normal: 'rgba(198,245,111,.22)' }
const DOT: Record<Severity, string> = { alarm: '#ffb9a2', fault: '#f9eb57', normal: '#c6f56f' }

function AlarmCard({ item, now, onClose, deviceName }: { item: Item; now: number; onClose: () => void; deviceName: string }) {
  const { row, state } = item
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#292929] p-4 text-white">
      <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full" style={{ background: `radial-gradient(circle, ${GLOW[state.severity]}, transparent 65%)` }} />
      <div className="relative flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11.5px] text-white/60">
            {deviceName} · {row.values['Object type']} {row.instance}
          </div>
          <div className="mt-0.5 truncate text-[15px] font-medium">{row.values['object-name']}</div>
        </div>
        <button aria-label="Close" onClick={onClose} className="inline-flex size-7 items-center justify-center rounded-full bg-white/10 text-white/70 hover:bg-white/20 hover:text-white">
          <XIcon className="size-3.5" />
        </button>
      </div>
      <div className="relative mt-4 flex items-center gap-2.5">
        <span className="size-2.5 shrink-0 rounded-full" style={{ background: DOT[state.severity] }} />
        <span className="text-[28px] leading-none font-medium tracking-[-0.02em]">{stateLabel(state.eventState)}</span>
      </div>
      <div className="relative mt-2.5 text-[12px] text-white/70">
        {state.since ? `Since ${clock(state.since)} · ${ago(state.since, now)}` : state.severity === 'normal' ? 'No transitions recorded' : 'Time not reported'}
      </div>
      <div className="relative mt-3 grid grid-cols-2 gap-3 border-t border-white/10 pt-3 text-[12px]">
        <div className="min-w-0">
          <div className="text-white/50">Value</div>
          <div className="mt-0.5 truncate font-medium tabular-nums">{valueText(row)}</div>
        </div>
        <div className="min-w-0">
          <div className="text-white/50">Acknowledged</div>
          <div className="mt-0.5 truncate font-medium">{state.unacked ? 'No' : 'Yes'}</div>
        </div>
      </div>
    </div>
  )
}

const FLAGS = ['to-offnormal', 'to-fault', 'to-normal']

function Setup({ row, condition }: { row: ObjectRow; condition: string }) {
  const v = row.values
  const enabled = (v['event-enable'] ?? '').split(';')
  return (
    <Group label="Set up">
      <dl className="m-0">
        <Detail label="Alarm when">{condition}</Detail>
        {v.deadband !== undefined ? <Detail label="Deadband">{v.deadband}</Detail> : null}
        {v['time-delay'] !== undefined ? <Detail label="Time delay">{v['time-delay']} s</Detail> : null}
        {v['time-delay-normal'] !== undefined ? <Detail label="Delay back to normal">{v['time-delay-normal']} s</Detail> : null}
        {v['notify-type'] ? <Detail label="Reported as">{v['notify-type'] === 'alarm' ? 'Alarm' : v['notify-type'] === 'event' ? 'Event' : v['notify-type']}</Detail> : null}
        {v['event-detection-enable'] === 'false' ? <Detail label="Detection">Switched off</Detail> : null}
        {v.reliability && v.reliability !== 'no-fault-detected' ? (
          <Detail label="Reliability">
            <span className="text-(--status-alarm-strong)">{v.reliability}</span>
          </Detail>
        ) : null}
      </dl>
      {v['event-enable'] !== undefined ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {TRANSITION_LABEL.map((label, i) => {
            const on = enabled.includes(FLAGS[i])
            return (
              <span
                key={label}
                title={on ? 'Reported' : 'Not reported'}
                className={cn('inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[11.5px]', on ? 'bg-(--surface-track)' : 'text-(--text-faint) line-through decoration-(--ink-4)')}
              >
                {label}
              </span>
            )
          })}
        </div>
      ) : null}
    </Group>
  )
}

function NotificationClass({ row, rows }: { row: ObjectRow; rows: ObjectRow[] }) {
  const n = row.values['notification-class']
  if (n === undefined) return null
  const nc = notificationClassOf(row, rows)
  const priorities = (nc?.values.priority ?? '').split('; ')
  const ack = (nc?.values['ack-required'] ?? '').split(';')
  const recipients = [...(nc?.values['recipient-list'] ?? '').matchAll(/fromTime=([\d:*]+)[^}]*?toTime=([\d:*]+)[^}]*?recipient=([\w-]+,?[\w.:]*)/g)].map((m) => ({ from: m[1], to: m[2], who: m[3] }))
  const hm = (t: string) => t.slice(0, 5)
  return (
    <Group label="Notification class" aside={<span className="text-[11.5px] tabular-nums text-(--text-faint)">#{n}</span>}>
      {nc ? (
        <>
          <div className="mb-1.5 truncate text-[12.5px] font-medium">{nc.values['object-name']}</div>
          <div className="overflow-hidden rounded-[10px] bg-(--surface-card-muted)">
            <div className="grid grid-cols-[minmax(0,1fr)_64px_72px] gap-2 px-3 py-1.5 text-[11px] text-(--text-muted)">
              <span>Transition</span>
              <span className="text-right">Priority</span>
              <span className="text-right">Needs ack</span>
            </div>
            {TRANSITION_LABEL.map((label, i) => (
              <div key={label} className="grid grid-cols-[minmax(0,1fr)_64px_72px] gap-2 border-t border-(--border-divider) px-3 py-1.5 text-[12px]">
                <span className="truncate">{label}</span>
                <span className="text-right tabular-nums">{priorities[i] ?? '–'}</span>
                <span className="text-right text-(--text-muted)">{ack.includes(FLAGS[i]) ? 'Yes' : 'No'}</span>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[12px] text-(--text-muted)">
            {recipients.length ? (
              <>
                Sent to {recipients.length} recipient{recipients.length === 1 ? '' : 's'}
                <ul className="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                  {recipients.slice(0, 6).map((m, i) => (
                    <li key={i} className="truncate text-(--text-strong)">
                      {m.who.replace(',', ' ')} <span className="text-(--text-muted)">· {hm(m.from)}–{hm(m.to)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : nc.values['recipient-list'] !== undefined ? (
              'No recipients: nobody is notified.'
            ) : (
              'Recipients not read.'
            )}
          </div>
        </>
      ) : (
        <p className="m-0 text-[12.5px] text-(--text-muted)">Notification class {n} is not among the objects read on this device.</p>
      )}
    </Group>
  )
}

function History({ state }: { state: AlarmState }) {
  return (
    <Group label="Last transitions">
      <div className="flex flex-col">
        {TRANSITION_LABEL.map((label, i) => {
          const t = state.stamps[i]
          return (
            <div key={label} className="flex min-h-9 items-center gap-2.5 border-t border-(--border-divider) text-[12.5px] first:border-t-0">
              <span className={cn('size-1.5 shrink-0 rounded-full', t ? (['bg-(--status-alarm-strong)', 'bg-(--status-warn-strong)', 'bg-(--status-ok-strong)'][i]) : 'bg-(--ink-4)')} />
              <span className="flex-1">{label}</span>
              <span className="tabular-nums text-(--text-muted)">{t ? clock(t) : 'Never'}</span>
              {t ? (
                state.acked[i] ? (
                  <CheckIcon aria-label="Acknowledged" className="size-3.5 text-(--text-faint)" />
                ) : (
                  <span title="Not acknowledged" className="size-2 rounded-full bg-(--status-warn-strong)" />
                )
              ) : (
                <span className="size-3.5" />
              )}
            </div>
          )
        })}
      </div>
      {state.source === 'live' ? <p className="m-0 mt-2 text-[11.5px] text-(--text-faint)">State and acknowledgements as the controller reports them now.</p> : null}
    </Group>
  )
}
