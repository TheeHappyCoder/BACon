import { useMemo, useState } from 'react'
import { api, type ControlAction, type Device, type ObjectRow, type Status } from '../api'
import { actionValue, propertyLabel, releaseSlot, undoAction, weekChange } from '../actions'
import { PRIORITY_NAMES } from '../control'
import { Button } from '../ui/components/button'
import { Input } from '../ui/components/input'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { cn } from '../ui/utils'
import { useControl } from './ControlState'
import { EmptyState } from './Inspector'
import { useToast } from './Toasts'

const { ReloadIcon, FileText, Search, XIcon } = Hugeicons

type Filter = 'all' | 'verified' | 'rejected' | 'unknown'
type Live = { slot: number | null; checked: true } | { error: string; checked: true }

const STATE: Record<string, { label: string; chip: string }> = {
  verified: { label: 'Verified', chip: 'bg-(--status-ok-bg)' },
  rejected: { label: 'Rejected', chip: 'bg-(--status-alarm-bg)' },
  unknown: { label: 'Not confirmed', chip: 'bg-(--status-warn-bg)' },
  sending: { label: 'Interrupted', chip: 'bg-(--status-warn-bg)' },
}

const when = (t: number) => {
  const d = new Date(t * 1000)
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${time}`
}

/** What a log entry did, in one line. */
function describeAction(a: ControlAction) {
  if (a.property === 'acknowledge') return actionValue(a, a.value)
  if (a.property === 'present-value') return a.release ? `Release priority ${a.priority}` : `Command ${actionValue(a, a.value)}${a.priority ? ` at priority ${a.priority}` : ''}`
  return `${propertyLabel(a.property)} → ${weekChange(a) ?? actionValue(a, a.value)}`
}
const beforeText = (a: ControlAction) =>
  a.property === 'acknowledge' ? '' : a.property === 'present-value' && a.priority ? `P${a.priority} was ${a.slotBefore == null ? 'empty' : actionValue(a, a.slotBefore)}` : `was ${actionValue(a, a.before)}`
const afterText = (a: ControlAction) =>
  a.property === 'acknowledge' ? '' : a.property === 'present-value' && a.priority ? (a.slotAfter === undefined ? '' : `P${a.priority} now ${a.slotAfter === null ? 'empty' : actionValue(a, a.slotAfter)}`) : a.current === undefined ? '' : `reads ${actionValue(a, a.current)}`

/**
 * BACon's own record, kept apart from what the controllers report: every write, release and acknowledgement it made,
 * with what was there before and what it read back. The priority slots it still holds are at the top, to release
 * before leaving site.
 */
export function ActivityView({ status, rows, devices, onShowInObjects, onReread }: {
  status: Status
  rows: ObjectRow[]
  devices: Device[]
  onShowInObjects: (row: ObjectRow) => void
  onReread: (targets: { device: number; typeId: number; instance: number }[]) => void
}) {
  const control = useControl()
  const toast = useToast()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [live, setLive] = useState<Record<string, Live>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const { actions, held } = control.log
  const rowsByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows])
  const deviceName = (n: number) => devices.find((d) => d.instance === n)?.name || `Device ${n}`
  const slotKey = (h: ControlAction) => `${h.key}#${h.priority}`

  const counts = { all: actions.length, verified: 0, rejected: 0, unknown: 0 } as Record<Filter, number>
  for (const a of actions) {
    if (a.state === 'verified') counts.verified++
    else if (a.state === 'rejected') counts.rejected++
    else counts.unknown++
  }
  const q = search.trim().toLowerCase()
  const shown = actions.filter(
    (a) =>
      (filter === 'all' || (filter === 'unknown' ? a.state !== 'verified' && a.state !== 'rejected' : a.state === filter)) &&
      (!q || `${a.name} ${deviceName(a.device)} ${a.property} ${describeAction(a)}`.toLowerCase().includes(q)),
  )

  async function check() {
    setBusy('check')
    const next: Record<string, Live> = {}
    for (const h of held) {
      try {
        const [p] = await api.controlPrepare([h as unknown as ObjectRow])
        next[slotKey(h)] = p.error ? { error: p.error, checked: true } : { slot: p.slots?.[h.priority! - 1] ?? null, checked: true }
      } catch (e) {
        next[slotKey(h)] = { error: e instanceof Error ? e.message : String(e), checked: true }
      }
    }
    setLive(next)
    setBusy(null)
  }

  async function release(list: ControlAction[]) {
    setProgress({ done: 0, total: list.length })
    let failed = 0
    for (const [i, h] of list.entries()) {
      try {
        const r = await releaseSlot(h, h.priority!)
        if (r.state !== 'verified') failed++
      } catch {
        failed++
      }
      setProgress({ done: i + 1, total: list.length })
    }
    setProgress(null)
    setLive({})
    control.refresh()
    onReread(list)
    toast(failed ? `Released ${list.length - failed} of ${list.length}; ${failed} need a look in the log` : `Released ${list.length} priority slot${list.length === 1 ? '' : 's'}`)
  }

  async function undo(a: ControlAction) {
    setBusy(a.id)
    try {
      const r = await undoAction(a)
      toast(r.state === 'verified' ? `Put back: ${a.name}` : `${a.name}: ${r.message}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
      control.refresh()
      onReread([a])
    }
  }

  function exportCsv() {
    const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Time', 'Device', 'Object', 'Property', 'Priority', 'Before', 'Requested', 'Read back', 'Outcome', 'Message'].join(',')]
    for (const a of actions) {
      lines.push([new Date(a.at * 1000).toISOString(), deviceName(a.device), a.name, a.property, a.priority ?? '', beforeText(a), describeAction(a), afterText(a), STATE[a.state]?.label ?? a.state, a.message ?? ''].map(cell).join(','))
    }
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }))
    const link = Object.assign(document.createElement('a'), { href: url, download: `BACon actions ${new Date().toISOString().slice(0, 10)}.csv` })
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex h-12 shrink-0 items-center border-b border-(--border-subtle) gap-1.5 pr-2 pl-4 text-[13px] text-(--text-muted)">
        <span>Activity</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-(--surface-card)">
          <div className="flex items-start gap-3 px-[18px] pt-[18px] pb-3">
            <div className="min-w-0 flex-1">
              <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">What BACon did</h1>
              <div className="mt-1 text-[12px] text-(--text-muted)">
                Every write, release and acknowledgement BACon sent, what was there before, and what it read back. Kept on this PC, apart from what the controllers report.
              </div>
            </div>
            <Button size="sm" variant="white" onClick={control.refresh}>
              <ReloadIcon />
              Refresh
            </Button>
            <Button size="sm" variant="secondary" disabled={!actions.length} onClick={exportCsv}>
              <FileText />
              Export CSV
            </Button>
          </div>

          <ScrollArea scrollFade className="min-h-0 flex-1">
            {/* what BACon still holds */}
            {held.length ? (
              <div className="mx-[18px] mb-3 overflow-hidden rounded-[14px] border border-(--border-subtle)">
                <div className="flex items-center gap-2 bg-(--surface-checked) px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium">BACon holds {held.length} priority slot{held.length === 1 ? '' : 's'}</div>
                    <div className="text-[11.5px] text-(--text-muted)">Commanded by BACon and not released by it. Release them before leaving site, or check whether the controller moved on.</div>
                  </div>
                  <Button size="xs" variant="ghost" loading={busy === 'check'} disabled={!status.connected || !!progress} onClick={() => void check()}>Check live</Button>
                  <Button size="xs" loading={!!progress} loadingText={progress ? `${progress.done} / ${progress.total}` : undefined} disabled={!status.connected} onClick={() => void release(held)}>
                    Release all {held.length}
                  </Button>
                </div>
                {held.map((h) => {
                  const l = live[slotKey(h)]
                  const row = rowsByKey.get(h.key)
                  const moved = l && 'slot' in l && l.slot !== h.value
                  return (
                    <div key={slotKey(h)} className="flex min-h-[46px] items-center gap-3 border-t border-(--border-divider) px-4 text-[12.5px]">
                      <span className="min-w-0 flex-1">
                        <button className="block max-w-full truncate text-left font-medium hover:underline" disabled={!row} onClick={() => row && onShowInObjects(row)}>{h.name}</button>
                        <span className="block truncate text-[11.5px] text-(--text-muted)">{deviceName(h.device)} · since {when(h.at)}</span>
                      </span>
                      <span className="shrink-0 text-right">
                        <span className="block tabular-nums">{actionValue(h, h.value)}</span>
                        <span className="block text-[11.5px] text-(--text-muted)">P{h.priority}{PRIORITY_NAMES[h.priority!] ? ` · ${PRIORITY_NAMES[h.priority!]}` : ''}</span>
                      </span>
                      <span className="w-[150px] shrink-0 text-[11.5px]">
                        {!l ? <span className="text-(--text-faint)">not checked</span> : 'error' in l ? <span className="text-(--status-alarm-strong)">{l.error}</span> : moved ? <span className="text-(--status-warn-strong)">controller now has {l.slot === null ? 'it empty' : actionValue(h, l.slot)}</span> : <span className="text-(--text-muted)">still held</span>}
                      </span>
                      <Button size="xs" variant="secondary" disabled={!status.connected || !!progress} onClick={() => void release([h])}>Release</Button>
                    </div>
                  )
                })}
              </div>
            ) : actions.length ? (
              <div className="mx-[18px] mb-3 flex items-center gap-2 rounded-[14px] bg-(--status-ok-bg) px-4 py-2.5 text-[12.5px]">
                <span className="size-1.5 rounded-full bg-(--status-ok-strong)" />
                BACon holds no priority slots. Everything it commanded has been released.
              </div>
            ) : null}

            {/* the log */}
            <div className="mx-[18px] mb-[18px] overflow-hidden rounded-[14px] border border-(--border-subtle)">
              <div className="flex h-11 items-center gap-1.5 px-3">
                {(['all', 'verified', 'rejected', 'unknown'] as Filter[]).map((f) => (
                  <button key={f} onClick={() => setFilter(f)} data-active={filter === f ? 'true' : undefined}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] text-(--text-muted) transition-colors hover:text-(--text-strong) data-[active=true]:bg-(--surface-track) data-[active=true]:text-(--text-strong)">
                    {f === 'all' ? 'All' : STATE[f].label}
                    <span className="tabular-nums text-(--text-faint)">{counts[f]}</span>
                  </button>
                ))}
                <span className="flex-1" />
                <label className="flex h-7 w-[220px] items-center gap-2 rounded-full border border-(--border-default) bg-(--surface-input) px-2.5">
                  <Search className="size-3.5 shrink-0 text-(--text-faint)" />
                  <Input unstyled nativeInput aria-label="Search actions" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" placeholder="Object, device or property" value={search} onChange={(e) => setSearch(e.target.value)} />
                  {search ? <button aria-label="Clear search" onClick={() => setSearch('')}><XIcon className="size-3 text-(--text-faint)" /></button> : null}
                </label>
              </div>
              {shown.length ? (
                <div className="min-w-[760px]">
                  <div className="grid grid-cols-[112px_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_96px_64px] gap-3 border-t border-(--border-divider) bg-(--surface-card-muted) px-4 py-1.5 text-[11.5px] text-(--text-muted)">
                    <span>When</span><span>Object</span><span>What BACon asked for</span><span>Controller</span><span>Outcome</span><span />
                  </div>
                  {shown.map((a) => {
                    const row = rowsByKey.get(a.key)
                    const undoable = a.property !== 'acknowledge' && (a.state === 'verified' || a.state === 'unknown')
                    return (
                      <div key={a.id} data-action-id={a.id} className="group/act grid min-h-[48px] grid-cols-[112px_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1fr)_96px_64px] items-center gap-3 border-t border-(--border-divider) px-4 py-1.5 text-[12.5px]">
                        <span className="text-[11.5px] tabular-nums text-(--text-muted)">{when(a.at)}</span>
                        <span className="min-w-0">
                          <button className="block max-w-full truncate text-left font-medium hover:underline disabled:no-underline" disabled={!row} onClick={() => row && onShowInObjects(row)}>{a.name}</button>
                          <span className="block truncate text-[11.5px] text-(--text-muted)">{deviceName(a.device)}</span>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate" title={describeAction(a)}>{describeAction(a)}</span>
                          <span className="block truncate text-[11.5px] text-(--text-muted)">{beforeText(a)}</span>
                        </span>
                        <span className="min-w-0 truncate text-[11.5px] text-(--text-muted)" title={a.message}>{afterText(a) || a.message}</span>
                        <span><span className={cn('inline-flex h-[22px] items-center rounded-full px-2 text-[11.5px]', STATE[a.state]?.chip)} title={a.message}>{STATE[a.state]?.label ?? a.state}</span></span>
                        <span className="text-right">
                          {undoable ? (
                            <Button size="xs" variant="ghost" className="opacity-0 group-hover/act:opacity-100 focus-visible:opacity-100" loading={busy === a.id} disabled={!status.connected || (busy !== null && busy !== a.id)} onClick={() => void undo(a)}
                              title={a.property === 'present-value' && a.priority ? (a.slotBefore == null ? `Release priority ${a.priority}` : `Put priority ${a.priority} back to ${actionValue(a, a.slotBefore)}`) : `Put back ${actionValue(a, a.before)}`}>
                              Undo
                            </Button>
                          ) : null}
                        </span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState title={actions.length ? 'Nothing matches' : 'BACon has not written anything yet'} text={actions.length ? 'Try another filter or a shorter search.' : 'Commands, property changes and acknowledgements you make from BACon are listed here, with what each one replaced.'} />
              )}
            </div>
          </ScrollArea>
        </section>
      </div>
    </main>
  )
}
