import { useMemo, useState } from 'react'
import type { ObjectRow } from '../api'
import { SYNTHETIC_COLUMNS } from '../exporters'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { ScrollArea } from '../ui/components/scroll-area'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { PointControl } from './PointControl'
import { useControl } from './ControlState'

const { Plus, XIcon, LineChart } = Hugeicons

/**
 * The right-hand drawer: one object. With a point picked, Overview shows its live value, a command box and the
 * priority array; Properties is YABE's property grid of what this object reports. Any property can be added as a
 * column from here, but the columns themselves (for every device, and for the export) are chosen in Columns.
 */
export function PropertiesPanel({
  subject,
  columns,
  onToggleColumn,
  onClearSubject,
  onReread,
  canRead,
  onWritten,
  onOpenSchedules,
  onTrend,
  trendLabel,
  trended,
}: {
  onTrend?: () => void
  /** the button's words, when it is not "Trend" (a trend log shows its history) */
  trendLabel?: string
  trended?: boolean
  subject: ObjectRow
  columns: string[]
  /** add or remove one property as a table/export column */
  onToggleColumn: (name: string) => void
  onClearSubject: () => void
  onReread: () => void
  canRead: boolean
  /** a command was sent to the subject: read it again so the table catches up */
  onWritten: () => void
  onOpenSchedules?: () => void
}) {
  const control = useControl()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<'overview' | 'properties'>('overview')
  const [reloadSignal, setReloadSignal] = useState(0)
  // a point, or anything else with settings BACon can write (not the device itself), gets the Overview tab
  const isPoint = subject.typeId !== 8 && (subject.values['present-value'] !== undefined || control.fieldsOf(subject).length > 0)
  const showing = isPoint ? tab : 'properties'

  const isColumn = useMemo(() => new Set(columns), [columns])
  const names = useMemo(
    () => [...new Set([...Object.keys(subject.values), ...Object.keys(subject.errors)])].filter((n) => !SYNTHETIC_COLUMNS.includes(n)),
    [subject],
  )

  const q = query.trim().toLowerCase()
  const list = names.filter((name) => !q || name.toLowerCase().includes(q) || (subject.values[name] ?? '').toLowerCase().includes(q))
  const vendor = list.filter((name) => name.includes('[')).sort((a, b) => a.localeCompare(b))
  const standard = list.filter((name) => !name.includes('[')).sort((a, b) => a.localeCompare(b))

  const value = (name: string) => {
    const err = subject.errors[name]
    if (err !== undefined)
      return (
        <span className="rounded-full bg-(--status-alarm-bg) px-2 py-px text-[11px]" title={err}>
          unreadable
        </span>
      )
    const v = subject.values[name]
    if (v === undefined || v === '') return <span className="text-(--ink-4)">–</span>
    return (
      <span className="block truncate text-[12.5px] tabular-nums" title={v}>
        {v}
      </span>
    )
  }

  const renderRow = (name: string) => {
    const on = isColumn.has(name)
    return (
      <div
        key={name}
        className="group/prop grid h-8 grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_24px] items-center gap-2.5 rounded-[9px] px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]"
      >
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px]" title={name}>
            {name}
          </span>
          {on ? (
            <span className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-(--surface-track) px-1.5 text-[10.5px] text-(--text-muted) group-hover/prop:hidden">column</span>
          ) : null}
        </span>
        <span className="min-w-0 text-right">{value(name)}</span>
        <Button
          aria-label={on ? 'Remove column' : 'Add as column'}
          title={on ? 'Remove column' : 'Add as column'}
          variant="ghost"
          size="icon-xs"
          className="size-6 opacity-0 group-hover/prop:opacity-100 focus-visible:opacity-100"
          onClick={() => onToggleColumn(name)}
        >
          {on ? <XIcon /> : <Plus />}
        </Button>
      </div>
    )
  }

  const renderSection = (title: string, note: string | undefined, empty: boolean, children: React.ReactNode) =>
    empty ? null : (
      <section className="flex flex-col gap-px">
        <div className="flex items-baseline justify-between px-2 pt-3 pb-1">
          <span className="text-[12px] text-(--text-muted)">{title}</span>
          {note ? <span className="text-[11px] text-(--text-faint)">{note}</span> : null}
        </div>
        {children}
      </section>
    )

  return (
    <aside className="flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
      <div key={subject.key} className="nc-view-in flex items-start gap-3 px-[18px] pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-(--text-faint)">
            {subject.values['Object type']} · {subject.instance}
          </div>
          <div className="mt-0.5 truncate text-[17px] font-medium tracking-[-0.01em]">{subject.values['object-name'] || 'Unnamed object'}</div>
        </div>
        <Button aria-label="Close this object" title="Close" variant="secondary" size="icon-xs" onClick={onClearSubject}>
          <XIcon />
        </Button>
      </div>

      {isPoint ? (
        <div className="px-[18px] pb-2">
          <Tabs value={showing} onValueChange={(v) => setTab(v as typeof tab)}>
            <TabsList className="w-full">
              <TabsTab value="overview" className="flex-1">Overview</TabsTab>
              <TabsTab value="properties" className="flex-1">Properties</TabsTab>
            </TabsList>
          </Tabs>
        </div>
      ) : null}

      {showing === 'overview' ? (
        <ScrollArea scrollFade className="min-h-0 flex-1">
          {subject.status !== 'ok' ? (
            <div className="mx-[18px] mb-1 rounded-[12px] bg-(--status-alarm-bg) px-3 py-2 text-[12px] leading-snug">{subject.values['Read status']}</div>
          ) : null}
          <PointControl key={subject.key} row={subject} canWrite={canRead} reloadSignal={reloadSignal} onWritten={onWritten} onOpenSchedules={onOpenSchedules} />
        </ScrollArea>
      ) : (
        <>
          <div className="px-[18px] pb-2">
            <Input size="sm" placeholder="Find a property, e.g. address, units, 3019" value={query} onChange={(e) => setQuery(e.target.value)} />
            {subject.status !== 'ok' ? (
              <div className="mt-2 rounded-[12px] bg-(--status-alarm-bg) px-3 py-2 text-[12px] leading-snug">{subject.values['Read status']}</div>
            ) : null}
          </div>
          <ScrollArea scrollFade className="min-h-0 flex-1">
            <div className="flex flex-col px-2.5 pb-3">
              {renderSection('Vendor-specific', 'not in an EDE export', !vendor.length, vendor.map(renderRow))}
              {renderSection('Standard', undefined, !standard.length, standard.map(renderRow))}
              {!vendor.length && !standard.length ? (
                <p className="m-0 px-2 py-4 text-center text-[12px] text-(--text-muted)">No property matches. Try a shorter search.</p>
              ) : null}
            </div>
          </ScrollArea>
        </>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-(--border-subtle) px-[18px] py-3">
        <span className="flex gap-1.5">
          {onTrend ? (
            <Button size="sm" variant="secondary" onClick={onTrend} disabled={trended}>
              <LineChart />
              {trended ? (trendLabel ? 'In Trends' : 'Trending') : trendLabel ?? 'Trend'}
            </Button>
          ) : null}
          <Button size="sm" variant="secondary" onClick={() => { onReread(); setReloadSignal((n) => n + 1) }} disabled={!canRead}>
            Read again
          </Button>
        </span>
      </div>
    </aside>
  )
}
