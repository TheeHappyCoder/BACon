import { useEffect, useState } from 'react'
import type { Point } from '../api'
import { GROUPS, SHORT, ago, who } from '../format'

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** Status in words, as small tinted pills: never coloured text. */
export function StatusPills({ p, compact = false }: { p: Point; compact?: boolean }) {
  const f = p.statusFlags ?? [0, 0, 0, 0]
  const pills: { text: string; bg: string }[] = []
  if (p.alarm && p.alarm.state !== 'normal' && p.alarm.state !== 'fault') pills.push({ text: 'In alarm', bg: 'var(--status-alarm-bg)' })
  if (f[1] || p.alarm?.state === 'fault') pills.push({ text: 'Fault', bg: 'var(--status-alarm-bg)' })
  if (f[3]) pills.push({ text: 'Out of service', bg: 'var(--status-warn-bg)' })
  if (p.commandable && p.activePriority != null && p.activePriority < 16) pills.push({ text: `Priority ${p.activePriority}`, bg: 'var(--status-info-bg)' })
  if (p.alarm && p.alarm.acked.some((b) => !b)) pills.push({ text: compact ? 'Unacked' : 'Not acknowledged', bg: 'var(--status-warn-bg)' })
  if (!pills.length) return null
  return (
    <span className="flex flex-wrap gap-1">
      {pills.map((x) => (
        <span key={x.text} className="inline-flex h-5 items-center rounded-full px-2 text-[11px] whitespace-nowrap text-(--status-ink)" style={{ background: x.bg }}>
          {x.text}
        </span>
      ))}
    </span>
  )
}

function Touch({ p, now }: { p: Point; now: number }) {
  const w = p.lastWrite
  const r = p.lastRead
  if (w && now - w.at < 120) {
    return (
      <span className="truncate">
        <span className="text-(--text-strong)">Written</span> by {who(w.by)} · {ago(w.at, now)}
      </span>
    )
  }
  if (r) {
    const fresh = now - r.at < 2
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className="size-1.5 shrink-0 rounded-full transition-colors duration-500" style={{ background: fresh ? 'var(--action-primary)' : 'var(--ink-4)' }} />
        <span className="truncate">Read by {who(r.by)} · {ago(r.at, now)}</span>
      </span>
    )
  }
  return <span className="text-(--text-faint)">Not read yet</span>
}

export function Points({ points, selected, onSelect }: { points: Point[]; selected: string | null; onSelect: (key: string) => void }) {
  const now = useNow()
  return (
    <div className="pb-4">
      {GROUPS.map((g) => {
        const rows = points.filter((p) => g.types.includes(p.type))
        if (!rows.length) return null
        return (
          <section key={g.title} className="mt-1">
            <h3 className="sticky top-0 z-[1] bg-(--surface-card) px-[18px] pt-3 pb-1.5 text-[11.5px] font-medium tracking-[0.02em] text-(--text-muted)">{g.title}</h3>
            <div className="mx-2.5">
              {rows.map((p) => (
                <button
                  key={p.key}
                  onClick={() => onSelect(p.key)}
                  data-selected={p.key === selected || undefined}
                  className="grid w-full grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1.3fr)] items-center gap-3 rounded-[12px] px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-(--surface-hover,#f5f5f5) data-selected:bg-(--color-primary-50)"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-(--text-strong)">{p.name}</span>
                    <span className="block text-[11.5px] tabular-nums text-(--text-muted)">
                      {SHORT[p.type] ?? p.type} {p.instance}
                    </span>
                  </span>
                  <span className="truncate font-medium tabular-nums text-(--text-strong)">{p.display || '—'}</span>
                  <span className="min-w-0">
                    <StatusPills p={p} compact />
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-(--text-muted)">
                    <Touch p={p} now={now} />
                  </span>
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
