import { useEffect, useMemo, useState } from 'react'
import { api, type ControlAction, type Device, type ObjectRow, type Status } from '../api'
import { actionValue, propertyLabel, releaseSlot, undoAction, weekChange } from '../actions'
import { PRIORITY_NAMES } from '../control'
import { Button } from '../ui/components/button'
import { Input } from '../ui/components/input'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { cn } from '../ui/utils'
import { useControl } from './ControlState'
import { EmptyState } from './Inspector'
import { useToast } from './Toasts'

const { Download, Search, XIcon, History, Lock, ArrowRight, Undo } = Hugeicons

type Filter = 'all' | 'verified' | 'rejected' | 'unknown'
type Live = { slot: number | null; checked: true } | { error: string; checked: true }

const STATE: Record<string, { label: string; chip: string; dot: string }> = {
  verified: { label: 'Verified', chip: 'bg-(--color-ns-green-light)', dot: 'bg-(--status-ok-strong)' },
  rejected: { label: 'Rejected', chip: 'bg-(--status-alarm-bg)', dot: 'bg-(--status-alarm-strong)' },
  unknown: { label: 'Not confirmed', chip: 'bg-(--status-warn-bg)', dot: 'bg-(--status-warn-strong)' },
  sending: { label: 'Interrupted', chip: 'bg-(--status-warn-bg)', dot: 'bg-(--status-warn-strong)' },
}
const GRID = 'grid-cols-[120px_minmax(0,1.1fr)_minmax(0,1.5fr)_minmax(0,1fr)_120px_84px]'

const timeOf = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
/** "Today", "Yesterday", "Saturday 25 Oct" */
function dayOf(t: number) {
  const d = new Date(t * 1000)
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  return days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })
}

/** A log entry as what it changed: the kind of change, the value before, and the value asked for. */
function changeOf(a: ControlAction): { what: string; from: string; to: string } {
  if (a.property === 'acknowledge') return { what: 'Acknowledge', from: '', to: actionValue(a, a.value) }
  if (a.property === 'present-value') {
    const from = a.priority ? (a.slotBefore == null ? 'empty' : actionValue(a, a.slotBefore)) : actionValue(a, a.before)
    if (a.release) return { what: `Release priority ${a.priority}`, from, to: 'empty' }
    return { what: a.priority ? `Command at priority ${a.priority}${PRIORITY_NAMES[a.priority] ? ` · ${PRIORITY_NAMES[a.priority]}` : ''}` : 'Write present value', from, to: actionValue(a, a.value) }
  }
  return { what: propertyLabel(a.property), from: weekChange(a) ? '' : actionValue(a, a.before), to: weekChange(a) ?? actionValue(a, a.value) }
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

  // the log lives on this PC but other screens write to it: read it again now and then while it is open
  useEffect(() => {
    const t = setInterval(control.refresh, 10000)
    return () => clearInterval(t)
  }, [control.refresh])

  // newest first, under a heading per day
  const days = useMemo(() => {
    const out: { label: string; items: ControlAction[] }[] = []
    for (const a of shown) {
      const label = dayOf(a.at)
      const last = out[out.length - 1]
      if (last && last.label === label) last.items.push(a)
      else out.push({ label, items: [a] })
    }
    return out
  }, [shown])

  const meta = [!actions.length ? 'Nothing written yet' : counts.rejected || counts.unknown ? 'Some need a look' : 'All verified']

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {/* what this is, and how it stands */}
      <header className="flex shrink-0 items-center gap-3.5 px-6 pt-5 pb-4">
        <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-(--ink) text-(--color-ns-green) shadow-[0_6px_16px_-8px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.08)] [&_svg]:size-[22px]">
          <History />
          <span className={cn('absolute -right-1 -bottom-1 size-3.5 rounded-full border-[2.5px] border-(--surface-card)', held.length ? 'bg-(--color-ns-cyan)' : counts.rejected ? 'bg-(--status-alarm-strong)' : 'bg-(--color-ns-green)')} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="m-0 truncate text-[22px] leading-7 font-medium tracking-[-0.02em]">Activity</h1>
          <div className="mt-0.5 truncate text-[12.5px] text-(--text-muted)">{meta.join(' · ')}</div>
        </div>
        <Button size="sm" variant="secondary" disabled={!actions.length} onClick={exportCsv}>
          <Download />
          Export
        </Button>
      </header>

      {/* what BACon still holds: to release before leaving site */}
      {held.length ? (
        <div className="mx-6 mb-4 shrink-0 overflow-hidden rounded-[16px] bg-(--surface-card) shadow-[0_0_0_1.5px_var(--ink),0_8px_24px_-14px_rgba(0,0,0,.25)]">
          <div className="flex items-center gap-3 px-4 py-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-(--ink) text-(--color-ns-cyan) [&_svg]:size-[17px]">
              <Lock />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-medium">
                BACon holds {held.length} priority slot{held.length === 1 ? '' : 's'}
              </div>
              <div className="text-[12px] text-(--text-muted)">Commanded by BACon and not released. Release them before you leave site.</div>
            </div>
            <Button size="sm" variant="ghost" loading={busy === 'check'} disabled={!status.connected || !!progress} onClick={() => void check()}>
              Check live
            </Button>
            <Button size="sm" loading={!!progress} loadingText={progress ? `${progress.done} / ${progress.total}` : undefined} disabled={!status.connected} onClick={() => void release(held)}>
              Release all {held.length}
            </Button>
          </div>
          {held.map((h) => {
            const l = live[slotKey(h)]
            const row = rowsByKey.get(h.key)
            const moved = l && 'slot' in l && l.slot !== h.value
            return (
              <div key={slotKey(h)} className="flex min-h-12 items-center gap-3 border-t border-(--border-divider) px-4 text-[12.5px]">
                <span className="min-w-0 flex-1">
                  <button className="block max-w-full truncate text-left font-medium hover:underline disabled:no-underline" disabled={!row} onClick={() => row && onShowInObjects(row)}>
                    {h.name}
                  </button>
                  <span className="block truncate text-[11.5px] text-(--text-muted)">
                    {deviceName(h.device)} · since {timeOf(h.at)}
                  </span>
                </span>
                <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-(--surface-track) px-2.5 text-[12px] tabular-nums">
                  <b className="font-medium">{actionValue(h, h.value)}</b>
                  <span className="text-(--text-muted)">
                    P{h.priority}
                    {PRIORITY_NAMES[h.priority!] ? ` · ${PRIORITY_NAMES[h.priority!]}` : ''}
                  </span>
                </span>
                <span className="w-[170px] shrink-0 text-right text-[11.5px]">
                  {!l ? (
                    <span className="text-(--text-faint)">not checked</span>
                  ) : 'error' in l ? (
                    <span className="text-(--status-alarm-strong)">{l.error}</span>
                  ) : moved ? (
                    <span className="text-(--status-warn-strong)">controller now has {l.slot === null ? 'it empty' : actionValue(h, l.slot)}</span>
                  ) : (
                    <span className="text-(--text-muted)">still held</span>
                  )}
                </span>
                <Button size="xs" variant="secondary" disabled={!status.connected || !!progress} onClick={() => void release([h])}>
                  Release
                </Button>
              </div>
            )
          })}
        </div>
      ) : null}

      {/* which outcomes, and a search */}
      <div className="flex shrink-0 items-center gap-3 px-6 pb-3">
        <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
          <TabsList>
            {(['all', 'verified', 'rejected', 'unknown'] as Filter[]).map((f) => (
              <TabsTab key={f} value={f} className="gap-1.5">
                {f === 'all' ? 'All' : STATE[f].label}
                <span className="tabular-nums text-(--text-faint)">{counts[f]}</span>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        {!held.length && actions.length ? (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-(--color-ns-green-light) px-3 text-[12.5px]">
            <span className="size-1.5 rounded-full bg-(--status-ok-strong)" />
            Nothing held · everything BACon commanded is released
          </span>
        ) : null}
        <span className="flex-1" />
        <label className="flex h-9 w-[280px] items-center gap-2 rounded-full border border-(--border-default) bg-(--surface-input) px-3 shadow-[0_1px_2px_rgba(0,0,0,.04)] transition-colors focus-within:border-(--ring) hover:border-(--border-strong)">
          <Search className="size-4 shrink-0 text-(--text-faint)" />
          <Input unstyled nativeInput aria-label="Search actions" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none" placeholder="Object, device or property" value={search} onChange={(e) => setSearch(e.target.value)} />
          {search ? (
            <button aria-label="Clear search" onClick={() => setSearch('')} className="inline-flex size-5 items-center justify-center rounded-full text-(--text-faint) hover:bg-(--surface-track) hover:text-(--text-strong)">
              <XIcon className="size-3" />
            </button>
          ) : null}
        </label>
      </div>

      {/* the log */}
      <ScrollArea scrollFade scrollFadeSides={{ top: false, left: false }} className="min-h-0 flex-1 border-t border-(--border-subtle)">
        {shown.length ? (
          <div className="min-w-[860px] pb-6">
            {days.map((day) => (
              <section key={day.label}>
                <div className={cn('sticky top-0 z-[2] grid h-9 items-center gap-4 border-b border-(--border-subtle) bg-(--surface-card-muted) px-6 text-[11.5px] text-(--text-muted)', GRID)}>
                  <span className="flex items-baseline gap-1.5 font-medium text-(--text-strong)">
                    {day.label}
                    <span className="font-normal text-(--text-faint) tabular-nums">{day.items.length}</span>
                  </span>
                  <span>Object</span>
                  <span>Change</span>
                  <span>Read back</span>
                  <span>Outcome</span>
                  <span />
                </div>
                {day.items.map((a) => {
                  const row = rowsByKey.get(a.key)
                  const undoable = a.property !== 'acknowledge' && (a.state === 'verified' || a.state === 'unknown')
                  const c = changeOf(a)
                  const st = STATE[a.state] ?? STATE.unknown
                  return (
                    <div key={a.id} data-action-id={a.id} className={cn('group/act grid min-h-14 items-center gap-4 border-b border-(--border-divider) px-6 py-2 text-[12.5px] transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_2.5%,transparent)]', GRID)}>
                      <span className="text-[12px] text-(--text-muted) tabular-nums">{timeOf(a.at)}</span>
                      <span className="min-w-0">
                        <button className="block max-w-full truncate text-left text-[13px] font-medium hover:underline disabled:no-underline" disabled={!row} onClick={() => row && onShowInObjects(row)}>
                          {a.name}
                        </button>
                        <span className="block truncate text-[11.5px] text-(--text-muted)">{deviceName(a.device)}</span>
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[11.5px] text-(--text-muted)">{c.what}</span>
                        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 tabular-nums">
                          {c.from ? (
                            <>
                              <span className="truncate text-(--text-muted)">{c.from}</span>
                              <ArrowRight className="size-3 shrink-0 text-(--text-faint)" />
                            </>
                          ) : null}
                          <span className="truncate rounded-full bg-(--color-ns-green-light) px-2 py-px font-medium" title={c.to}>
                            {c.to}
                          </span>
                        </span>
                      </span>
                      <span className="min-w-0 truncate text-[12px] text-(--text-muted)" title={a.message}>
                        {afterText(a) || a.message}
                      </span>
                      <span>
                        <span className={cn('inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium', st.chip)} title={a.message}>
                          <span className={cn('size-1.5 rounded-full', st.dot)} />
                          {st.label}
                        </span>
                      </span>
                      <span className="text-right">
                        {undoable ? (
                          <Button
                            size="xs"
                            variant="ghost"
                            className="opacity-0 group-hover/act:opacity-100 focus-visible:opacity-100"
                            loading={busy === a.id}
                            disabled={!status.connected || (busy !== null && busy !== a.id)}
                            onClick={() => void undo(a)}
                            title={a.property === 'present-value' && a.priority ? (a.slotBefore == null ? `Release priority ${a.priority}` : `Put priority ${a.priority} back to ${actionValue(a, a.slotBefore)}`) : `Put back ${actionValue(a, a.before)}`}
                          >
                            <Undo />
                            Undo
                          </Button>
                        ) : null}
                      </span>
                    </div>
                  )
                })}
              </section>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<History className="size-5" />}
            title={actions.length ? 'Nothing matches' : 'BACon has not written anything yet'}
            text={actions.length ? 'Try another filter or a shorter search.' : 'Commands, property changes and acknowledgements you make from BACon are listed here, with what each one replaced.'}
          />
        )}
      </ScrollArea>
    </main>
  )
}
