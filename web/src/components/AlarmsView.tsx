import { useEffect, useMemo, useState } from 'react'
import { api, type Device, type ObjectRow, type Status } from '../api'
import { propertyLabel } from '../actions'
import { INLINE_KINDS } from '../fields'
import { useControl } from './ControlState'
import { PropertyWrite } from './PropertyWrite'
import { TRANSITION_LABEL, ago, clock, conditionText, isAlarmObject, notificationClassOf, stateLabel, stateOf, type AlarmState, type Live, type Severity } from '../alarms'
import { unitShort } from '../schedule'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { Input } from '../ui/components/input'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { cn } from '../ui/utils'
import { Detail, EmptyState, Group } from './Inspector'
import { PaneToggle } from './Layout'
import { PanelBody, PanelFooter, PanelHeader, SidePanel } from './SidePanel'
import { SPIN, useSpin } from './spin'

const { Notification, CheckIcon, ReloadIcon, XIcon, Search } = Hugeicons

type Filter = 'active' | 'alarm' | 'fault' | 'unacked' | 'all'
type Item = { row: ObjectRow; state: AlarmState; condition: string }

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
  const deviceName = (inst: number) => devices.find((d) => d.instance === inst)?.name || `Device ${inst}`
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
    if (q && ![i.row.values['object-name'], deviceName(i.row.device), i.condition, stateLabel(i.state.eventState)].some((v) => (v ?? '').toLowerCase().includes(q))) return false
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
        : `Live from the controller${alarmDevices.length === 1 ? '' : 's'} · checked ${ago(checkedAt, now)}${failed.length ? ' · some from the last read' : ''}`

  const tabs: { key: Filter; label: string; count: number }[] = [
    { key: 'active', label: 'Active', count: items.filter((i) => i.state.severity !== 'normal' || i.state.unacked).length },
    { key: 'alarm', label: 'In alarm', count: counts.alarm },
    { key: 'fault', label: 'Fault', count: counts.fault },
    { key: 'unacked', label: 'Not acknowledged', count: counts.unacked },
    { key: 'all', label: 'All set up', count: counts.all },
  ]
  // sections read top to bottom by what needs doing: in alarm, in fault, back to normal but waiting, then normal
  const sections = [
    { key: 'alarm', title: 'In alarm', items: shown.filter((i) => i.state.severity === 'alarm') },
    { key: 'fault', title: 'Fault', items: shown.filter((i) => i.state.severity === 'fault') },
    { key: 'unacked', title: 'Normal, waiting for acknowledgement', items: shown.filter((i) => i.state.severity === 'normal' && i.state.unacked) },
    { key: 'normal', title: 'Normal', items: shown.filter((i) => i.state.severity === 'normal' && !i.state.unacked) },
  ].filter((s) => s.items.length)
  const GRID = multiDevice
    ? 'grid-cols-[minmax(200px,1.5fr)_minmax(110px,0.8fr)_136px_96px_minmax(150px,1.2fr)_120px_150px]'
    : 'grid-cols-[minmax(200px,1.5fr)_136px_96px_minmax(150px,1.2fr)_120px_150px]'
  const live_ = status.connected && checkedAt && failed.length < alarmDevices.length

  const header = (
    <header className="flex shrink-0 items-center gap-3.5 px-6 pt-5 pb-4">
      <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-(--ink) text-(--color-ns-green) shadow-[0_6px_16px_-8px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.08)] [&_svg]:size-[22px]">
        <Notification />
        <span className={cn('absolute -right-1 -bottom-1 size-3.5 rounded-full border-[2.5px] border-(--surface-card)', counts.alarm ? 'bg-(--status-alarm-strong)' : counts.fault ? 'bg-(--status-warn-strong)' : items.length ? 'bg-(--color-ns-green)' : 'bg-(--ink-4)')} />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="m-0 truncate text-[22px] leading-7 font-medium tracking-[-0.02em]">Alarms</h1>
        <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12.5px] text-(--text-muted)">
          {live_ ? (
            <span className="relative inline-flex size-1.5 shrink-0">
              <span className="nc-ping absolute inset-0 rounded-full bg-(--status-ok-strong)" />
              <span className="relative inline-flex size-1.5 rounded-full bg-(--status-ok-strong)" />
            </span>
          ) : null}
          <span className="truncate">{items.length ? sourceLine : 'Nothing set up in the objects read so far'}</span>
        </div>
      </div>
      {items.length ? (
        <Button size="sm" variant="secondary" disabled={!status.connected || checking} title={status.connected ? undefined : 'Connect to check'} onClick={check}>
          <ReloadIcon className={checking ? SPIN : ''} />
          Check now
        </Button>
      ) : null}
      {selected ? <PaneToggle side="right" /> : null}
    </header>
  )

  if (!items.length) {
    return (
      <main className="flex min-w-0 flex-1 flex-col">
        {header}
        <div className="flex min-h-0 flex-1 items-center justify-center border-t border-(--border-subtle)">
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
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="flex min-w-0 flex-1 flex-col">
        {header}

        {/* which alarms, and a search */}
        <div className="flex shrink-0 items-center gap-3 px-6 pb-3">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
            <TabsList>
              {tabs.map((t) => (
                <TabsTab key={t.key} value={t.key} className="gap-1.5">
                  {t.label}
                  <span className={cn('tabular-nums', t.key === 'alarm' && t.count ? 'text-(--status-alarm-strong)' : 'text-(--text-faint)')}>{t.count}</span>
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
          <span className="flex-1" />
          <label className="flex h-9 w-[260px] items-center gap-2 rounded-full border border-(--border-default) bg-(--surface-input) px-3 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors focus-within:border-(--ring) hover:border-(--border-strong)">
            <Search className="size-4 shrink-0 text-(--text-faint)" />
            <Input unstyled nativeInput aria-label="Search alarms" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" placeholder="Object, device or state" value={search} onChange={(e) => setSearch(e.target.value)} />
            {search ? (
              <button aria-label="Clear search" onClick={() => setSearch('')} className="inline-flex size-5 items-center justify-center rounded-full text-(--text-faint) hover:bg-(--surface-track) hover:text-(--text-strong)">
                <XIcon className="size-3" />
              </button>
            ) : null}
          </label>
        </div>

        {/* the alarms, by what needs doing */}
        <ScrollArea scrollFade scrollFadeSides={{ top: false, left: false }} className="min-h-0 flex-1 border-t border-(--border-subtle)">
          {sections.length ? (
            <div className="min-w-[860px] pb-6">
              {sections.map((sec) => (
                <section key={sec.key}>
                  <div className={cn('sticky top-0 z-[2] grid h-9 items-center gap-4 border-b border-(--border-subtle) bg-(--surface-card-muted) px-6 text-[11.5px] text-(--text-muted)', GRID)}>
                    <span className="flex items-center gap-1.5 font-medium text-(--text-strong)">
                      <span className={cn('size-1.5 rounded-full', sec.key === 'alarm' ? 'bg-(--status-alarm-strong)' : sec.key === 'fault' ? 'bg-(--status-warn-strong)' : sec.key === 'unacked' ? 'bg-(--status-warn)' : 'bg-(--status-ok-strong)')} />
                      {sec.title}
                      <span className="font-normal text-(--text-faint) tabular-nums">{sec.items.length}</span>
                    </span>
                    {multiDevice ? <span>Device</span> : null}
                    <span>State</span>
                    <span className="text-right">Value</span>
                    <span>Alarm when</span>
                    <span>Since</span>
                    <span>Acknowledged</span>
                  </div>
                  {sec.items.map((i) => {
                    const on = selectedKey === i.row.key
                    return (
                      <button
                        key={i.row.key}
                        onClick={() => setSelectedKey((k) => (k === i.row.key ? null : i.row.key))}
                        aria-pressed={on}
                        className={cn(
                          'relative grid min-h-14 w-full items-center gap-4 border-b border-(--border-divider) px-6 py-2 text-left text-[12.5px] transition-colors',
                          on ? 'bg-(--surface-selected)' : 'hover:bg-[color-mix(in_srgb,var(--ink)_2.5%,transparent)]',
                          GRID,
                        )}
                      >
                        {on ? <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] rounded-r-full bg-(--ink)" /> : null}
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-medium">{i.row.values['object-name'] || i.row.key}</span>
                          <span className="block truncate text-[11.5px] text-(--text-muted)">
                            {i.row.values['Object type']} {i.row.instance}
                          </span>
                        </span>
                        {multiDevice ? <span className="truncate text-(--text-muted)">{deviceName(i.row.device)}</span> : null}
                        <span>
                          <StateChip state={i.state} />
                        </span>
                        <span className="truncate text-right text-[13px] font-medium tabular-nums">{valueText(i.row)}</span>
                        <span className="truncate text-(--text-muted)" title={i.condition}>
                          {i.condition}
                        </span>
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
                    )
                  })}
                </section>
              ))}
            </div>
          ) : (
            <EmptyState
              title={filter === 'active' ? 'Nothing in alarm' : 'Nothing here'}
              text={
                filter === 'active'
                  ? `All ${items.length} object${items.length === 1 ? '' : 's'} with an alarm set up ${items.length === 1 ? 'is' : 'are'} normal and acknowledged.`
                  : search
                    ? 'No alarm matches the search.'
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
      </main>

      <SidePanel open={!!selected} subjectKey={selected?.row.key}>
        {selected ? (
          <>
            <PanelHeader
              eyebrow={`${deviceName(selected.row.device)} · ${selected.row.values['Object type']} ${selected.row.instance}`}
              title={selected.row.values['object-name'] || selected.row.key}
              onClose={() => setSelectedKey(null)}
            />
            <PanelBody>
              <AlarmCard item={selected} now={now} />
              <Acknowledge item={selected} canWrite={status.connected} onDone={() => onCheck([selected.row.device], [selected.row])} />
              <Setup row={selected.row} condition={selected.condition} />
              <ChangeSetup row={selected.row} canWrite={status.connected} onWritten={() => onCheck([selected.row.device], [selected.row])} />
              <NotificationClass row={selected.row} rows={rows} />
              <History state={selected.state} />
            </PanelBody>
            <PanelFooter>
              <Button size="sm" variant="secondary" onClick={() => onShowInObjects(selected.row)}>
                Show in Objects
              </Button>
              <Button size="sm" variant="secondary" disabled={!status.connected || rereading} onClick={() => spinReread(() => onReread(selected.row))}>
                <ReloadIcon className={rereading ? SPIN : ''} />
                Read again
              </Button>
            </PanelFooter>
          </>
        ) : null}
      </SidePanel>
    </>
  )
}

const GLOW: Record<Severity, string> = { alarm: 'rgba(255,185,162,.32)', fault: 'rgba(249,235,87,.26)', normal: 'rgba(198,245,111,.22)' }
const DOT: Record<Severity, string> = { alarm: '#ffb9a2', fault: '#f9eb57', normal: '#c6f56f' }

function AlarmCard({ item, now }: { item: Item; now: number }) {
  const { row, state } = item
  return (
    <div className="relative overflow-hidden rounded-2xl bg-[#292929] p-4 text-white">
      <div className="pointer-events-none absolute -top-16 -right-16 size-56 rounded-full" style={{ background: `radial-gradient(circle, ${GLOW[state.severity]}, transparent 65%)` }} />
      <div className="relative flex items-center gap-2.5">
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

/** Acknowledge each transition the controller is waiting on, with the controller's own time stamp for it. */
function Acknowledge({ item, canWrite, onDone }: { item: Item; canWrite: boolean; onDone: () => void }) {
  const control = useControl()
  const [busy, setBusy] = useState<number | null>(null)
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const pending = [0, 1, 2].filter((i) => !item.state.acked[i])
  if (!pending.length && !note) return null
  return (
    <Group label="Waiting for acknowledgement" aside={pending.length > 1 ? <Button size="xs" variant="ghost" className="-my-1" disabled={!canWrite || busy !== null} onClick={async () => { for (const i of pending) await ack(i) }}>All</Button> : null}>
      <div className="flex flex-col gap-1.5">
        {pending.map((i) => (
          <div key={i} className="flex items-center justify-between gap-3 text-[12.5px]">
            <span>
              {TRANSITION_LABEL[i]}
              {item.state.stamps[i] ? <span className="text-(--text-muted)"> · {clock(item.state.stamps[i]!)}</span> : null}
            </span>
            <Button size="xs" loading={busy === i} disabled={!canWrite || (busy !== null && busy !== i)} onClick={() => void ack(i)}>Acknowledge</Button>
          </div>
        ))}
        {note ? <p role="status" className={cn('m-0 rounded-[9px] px-2.5 py-1.5 text-[11.5px]', note.ok ? 'bg-(--status-ok-bg)' : 'bg-(--status-alarm-bg)')}>{note.text}</p> : null}
      </div>
    </Group>
  )

  async function ack(i: number) {
    setBusy(i)
    try {
      const r = await api.acknowledge(item.row, i)
      setNote({ ok: r.state === 'verified', text: r.state === 'verified' ? `${TRANSITION_LABEL[i]} acknowledged by BACon.` : r.message ?? r.state })
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
      control.refresh()
      onDone()
    }
  }
}

/** The alarm's settings, written on the point itself: limits, deadband, delays, what is reported and to whom. */
function ChangeSetup({ row, canWrite, onWritten }: { row: ObjectRow; canWrite: boolean; onWritten: () => void }) {
  const control = useControl()
  const fields = control.fieldsOf(row)
  const alarm = (control.writable?.alarm ?? []).map((p) => fields.find(([q]) => q === p)).filter((f): f is (typeof fields)[number] => !!f && INLINE_KINDS.has(f[1].kind))
  if (!alarm.length) return null
  const units = unitShort(row.values.units ?? '')
  return (
    <Group label="Change set up" aside={<span className="text-[11px] text-(--text-faint)">{canWrite ? 'written to the point' : 'connect to change'}</span>}>
      <div className="-mx-2 flex flex-col">
        {alarm.map(([property, spec]) => (
          <PropertyWrite key={property} row={row} property={property} spec={spec} label={propertyLabel(property)} canWrite={canWrite} onWritten={onWritten}
            shapeOf={(f) => ({ kind: f.kind, choices: f.choices, bits: f.bits, units: f.kind === 'real' && ['high-limit', 'low-limit', 'deadband'].includes(property) ? units : undefined })} />
        ))}
      </div>
    </Group>
  )
}
