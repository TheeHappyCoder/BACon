import { Button } from '@ui/components/button'
import type { Control, Point, Running } from '../api'
import { STATE_LABEL, ago, when } from '../format'

const lastChange = (p: Point) => Math.max(...(p.alarm?.stamps.map((s) => s ?? 0) ?? [0]))

export function AlarmsView({ s, control, onSelect }: { s: Running; control: (c: Control) => void; onSelect: (key: string) => void }) {
  const list = s.points.filter((p) => p.alarm)
  return (
    <div className="px-[18px] pt-4 pb-6">
      <div className="overflow-hidden rounded-[14px] border border-(--border-subtle)">
        {list.map((p) => {
          const a = p.alarm!
          const active = a.state !== 'normal'
          const unacked = a.acked.map((b, i) => (b ? null : ['offnormal', 'fault', 'normal'][i])).filter(Boolean) as string[]
          return (
            <div key={p.key} className="flex items-center gap-3 border-t border-(--border-subtle) px-3.5 py-3 first:border-t-0">
              <span className="size-2 shrink-0 rounded-full" style={{ background: active ? (a.state === 'fault' ? 'var(--status-warn-strong)' : 'var(--status-alarm-strong)') : 'var(--status-ok-strong)' }} />
              <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(p.key)}>
                <div className="truncate text-[13px] font-medium">{p.name}</div>
                <div className="truncate text-[12px] text-(--text-muted)">
                  {STATE_LABEL[a.state] ?? a.state} · now {p.display}
                  {lastChange(p) ? ` · changed ${ago(lastChange(p))}` : ' · never triggered'}
                </div>
              </button>
              {unacked.length ? (
                <Button size="xs" variant="secondary" onClick={() => unacked.forEach((st) => control({ action: 'ack', key: p.key, value: st }))}>
                  Acknowledge
                </Button>
              ) : (
                <span className="text-[11.5px] text-(--text-muted)">{active ? 'Acknowledged' : ''}</span>
              )}
            </div>
          )
        })}
      </div>

      <h3 className="mt-6 mb-2 text-[12px] font-medium text-(--text-muted)">Make something happen</h3>
      <div className="grid grid-cols-2 gap-2.5">
        {[
          { title: 'Overheat the room', text: 'Room temperature to 27.5 °C, past its 26 °C high limit. It alarms after 30 s.', go: () => control({ action: 'temp', value: 27.5 }) },
          { title: 'Open the window', text: 'The window contact alarms after 5 s, and heating and cooling stop.', go: () => control({ action: 'window', value: !s.room.window }), on: s.room.window },
          { title: 'Break the sensor', text: 'The room sensor reads -50 °C with reliability open-loop: a fault.', go: () => control({ action: 'fault', name: 'sensor', value: !s.faults.sensor }), on: s.faults.sensor },
          { title: 'Pack the room', text: 'Twelve people: CO2 climbs past 1200 ppm within a few minutes (faster at 120×).', go: () => control({ action: 'people', value: s.room.people >= 12 ? null : 12 }), on: s.room.people >= 12 },
        ].map((x) => (
          <button key={x.title} onClick={x.go} className="rounded-[14px] border border-(--border-subtle) p-3.5 text-left transition-colors hover:border-(--border-default) data-on:border-(--action-primary) data-on:bg-(--color-primary-50)" data-on={x.on || undefined}>
            <div className="text-[13px] font-medium">{x.on ? `Undo: ${x.title.toLowerCase()}` : x.title}</div>
            <div className="mt-0.5 text-[12px] text-(--text-muted)">{x.text}</div>
          </button>
        ))}
      </div>
      <p className="mt-4 text-[12px] text-(--text-muted)">
        A BMS sees these through GetEventInformation, GetAlarmSummary and the objects' event-state, and can acknowledge them with AcknowledgeAlarm. Last time synchronised: {when(s.device.lastSync?.at ?? null)}.
      </p>
    </div>
  )
}
