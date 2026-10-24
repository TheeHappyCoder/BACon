import { useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import { ScrollArea } from '@ui/components/scroll-area'
import { Tabs, TabsList, TabsTab } from '@ui/components/tabs'
import type { Activity, Control, Point, Running } from '../api'
import { isAlarming, needsAck } from '../format'
import { ActivityLog } from '../components/ActivityLog'
import { AddDevices } from '../components/AddDevices'
import { AlarmsView } from '../components/AlarmsView'
import { DeviceView } from '../components/DeviceView'
import { Faceplate } from '../components/Faceplate'
import { Inspector } from '../components/Inspector'
import { Points } from '../components/Points'
import { PowerSwitch } from '../components/PowerSwitch'
import { RasherMark } from '../components/RasherMark'
import { RoomPanel } from '../components/RoomPanel'
import { TrendsView } from '../components/TrendsView'

const { PanelLeftClose, XIcon } = Hugeicons

type View = 'points' | 'activity' | 'alarms' | 'trends' | 'device'

const count = (n: number, tone = 'var(--surface-track)') => (
  <span className="rounded-full px-1.5 text-[11px] leading-[18px] tabular-nums text-(--ink)" style={{ background: tone }}>
    {n}
  </span>
)

/** Everything: the unit and the room on the left, the device's points, traffic, alarms and trends in the middle,
 *  and the selected point on the right. */
export function Expanded({
  s,
  activity,
  network,
  control,
  onCollapse,
  onAdd,
  switcher,
}: {
  s: Running
  activity: Activity[]
  network: number
  control: (c: Control) => Promise<void>
  onCollapse: () => void
  onAdd: (count: number) => Promise<void>
  switcher?: React.ReactNode
}) {
  const [view, setView] = useState<View>('points')
  const [selected, setSelected] = useState<string | null>(null)
  const [seen, setSeen] = useState(network)
  const point = s.points.find((p) => p.key === selected) ?? null
  const alarms = s.points.filter(isAlarming).length
  const unacked = s.points.filter(needsAck).length
  const unread = view === 'activity' ? 0 : Math.max(0, network - seen)
  const degraded = !s.device.powered || s.device.restarting || s.device.dcc !== 'enable'
  const mode = s.points.find((p) => p.key === 'multi-state-value,1') as Point

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-(--surface-page) text-(--text-strong)">
      <header className="flex h-[54px] shrink-0 items-center gap-3 px-4">
        <RasherMark size={26} state={!s.device.powered ? 'stopped' : degraded ? 'degraded' : 'online'} />
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate text-[15px] font-medium tracking-[-0.01em]">{s.device.name}</span>
          <span className="truncate text-[12.5px] tabular-nums text-(--text-muted)">
            device {s.device.instance} · {s.device.ip}:{s.device.port}
            {s.device.dcc !== 'enable' ? ' · communication disabled' : ''}
          </span>
        </span>
        <div className="flex-1" />
        {switcher}
        <AddDevices onAdd={onAdd} align="right" />
        <PowerSwitch on={s.device.powered} booting={s.device.restarting} onChange={(v) => control({ action: 'power', value: v })} />
        <button onClick={onCollapse} className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)">
          <PanelLeftClose className="size-3.5" />
          Less
        </button>
      </header>

      <div className="flex min-h-0 flex-1 gap-3 px-3 pb-3">
        <aside className="flex w-[340px] shrink-0 flex-col gap-3 overflow-y-auto">
          <div className="pt-4">
            <Faceplate
              s={s}
              activityCount={network}
              onOffset={(v) => control({ action: 'offset', value: v })}
              onPresence={() =>
                mode.activePriority === 8
                  ? control({ action: 'release', key: 'multi-state-value,1', priority: 8 })
                  : control({ action: 'write', key: 'multi-state-value,1', value: 1, priority: 8 })
              }
            />
          </div>
          <RoomPanel s={s} control={control} />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
          <div className="border-b border-(--border-subtle) px-[18px] pt-2">
            <Tabs
              value={view}
              onValueChange={(v) => {
                setView(v as View)
                if (v === 'activity') setSeen(network)
              }}
            >
              <TabsList variant="underline" className="w-auto gap-6 border-b-0">
                <TabsTab value="points">Points {count(s.points.length)}</TabsTab>
                <TabsTab value="activity">Activity {unread ? count(unread, 'var(--status-info-bg)') : null}</TabsTab>
                <TabsTab value="alarms">Alarms {alarms ? count(alarms, 'var(--status-alarm-bg)') : unacked ? count(unacked, 'var(--status-warn-bg)') : null}</TabsTab>
                <TabsTab value="trends">Trends</TabsTab>
                <TabsTab value="device">Network and faults</TabsTab>
              </TabsList>
            </Tabs>
          </div>
          <ScrollArea key={view} className="min-h-0 flex-1">
            {view === 'points' ? <Points points={s.points} selected={selected} onSelect={setSelected} /> : null}
            {view === 'activity' ? <ActivityLog items={activity} onSelect={setSelected} /> : null}
            {view === 'alarms' ? <AlarmsView s={s} control={control} onSelect={setSelected} /> : null}
            {view === 'trends' ? <TrendsView instance={s.device.instance} /> : null}
            {view === 'device' ? <DeviceView s={s} control={control} /> : null}
          </ScrollArea>
        </section>

        {point ? (
          <aside className="relative flex w-[340px] shrink-0 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
            <button aria-label="Close" onClick={() => setSelected(null)} className="absolute top-3 right-3 z-10 inline-flex size-7 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)">
              <XIcon className="size-4" />
            </button>
            <ScrollArea className="min-h-0 flex-1">
              <Inspector key={point.key} p={point} control={control} />
            </ScrollArea>
          </aside>
        ) : null}
      </div>
    </div>
  )
}
