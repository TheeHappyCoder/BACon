import { useMemo, useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Activity } from '../api'
import { clock, who } from '../format'

const { Eye, Pencil, Bell, Radar, Settings2, BanIcon, Activity: Pulse, MousePointer2 } = Hugeicons

const KIND: Record<Activity['kind'], { label: string; icon: typeof Eye; tone: string }> = {
  read: { label: 'Reads', icon: Eye, tone: 'var(--surface-track)' },
  write: { label: 'Writes', icon: Pencil, tone: 'var(--status-info-bg)' },
  cov: { label: 'COV', icon: Pulse, tone: 'var(--status-ok-bg)' },
  alarm: { label: 'Alarms', icon: Bell, tone: 'var(--status-warn-bg)' },
  discovery: { label: 'Discovery', icon: Radar, tone: 'var(--surface-track)' },
  device: { label: 'Device', icon: Settings2, tone: 'var(--surface-track)' },
  dropped: { label: 'Ignored', icon: BanIcon, tone: 'var(--status-alarm-bg)' },
  local: { label: 'Here', icon: MousePointer2, tone: 'var(--surface-card-muted)' },
}

const FILTERS: { value: string; label: string }[] = [
  { value: 'all', label: 'Everything' },
  { value: 'network', label: 'From the network' },
  { value: 'write', label: 'Writes' },
  { value: 'cov', label: 'COV' },
  { value: 'alarm', label: 'Alarms' },
  { value: 'dropped', label: 'Ignored' },
]

export function ActivityLog({ items, onSelect }: { items: Activity[]; onSelect: (key: string) => void }) {
  const [filter, setFilter] = useState('all')
  const shown = useMemo(() => {
    const list = items.filter((a) =>
      filter === 'all' ? true : filter === 'network' ? a.kind !== 'local' && a.source !== 'Rasher' && a.source !== 'Room' : a.kind === filter,
    )
    return list.slice().reverse()
  }, [items, filter])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1.5 px-[18px] pt-3 pb-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`h-7 rounded-full px-3 text-[12px] transition-colors ${filter === f.value ? 'bg-(--ink) text-white' : 'bg-(--surface-track) text-(--text-muted) hover:text-(--text-strong)'}`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 px-8 pb-10 text-center">
          <p className="text-[14px] font-medium">Nothing yet</p>
          <p className="max-w-[340px] text-[12.5px] text-(--text-muted)">Point a BMS or BACon at this device. Every request it answers shows up here as it happens.</p>
        </div>
      ) : (
        <ol className="px-2.5 pb-4">
          {shown.map((a) => {
            const k = KIND[a.kind] ?? KIND.read
            const Icon = k.icon
            return (
              <li key={a.id} className="rs-row-in">
                <button
                  onClick={() => a.object && onSelect(a.object)}
                  disabled={!a.object}
                  className="grid w-full grid-cols-[58px_26px_minmax(0,150px)_minmax(0,1fr)] items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left text-[12.5px] enabled:hover:bg-(--surface-card-muted)"
                >
                  <span className="tabular-nums text-(--text-muted)">{clock(a.t)}</span>
                  <span className="inline-flex size-[22px] items-center justify-center rounded-full" style={{ background: k.tone }}>
                    <Icon className="size-3 text-(--ink)" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-(--text-strong)">{a.service}</span>
                    <span className="block truncate text-[11px] text-(--text-muted)">{a.source === 'Rasher' ? 'you' : who(a.source)}</span>
                  </span>
                  <span className="truncate text-(--text-strong)">{a.detail}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
