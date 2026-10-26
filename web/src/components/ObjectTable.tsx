import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectRow } from '../api'
import { cell } from '../exporters'
import { isNumericProp } from '../query'
import { Hugeicons } from '../ui/components/hugeicons'
import { Skeleton } from '../ui/components/skeleton'
import { cn } from '../ui/utils'
import { Tick } from './Tick'
import { valueMarkers } from '../triage'
import { ErrorPill, ValueCell, formatValue } from '../value'

const { ArrowUp, Plus, XIcon } = Hugeicons

export const MAX_RENDERED_ROWS = 2000
export type Sort = { column: string; dir: 1 | -1 } | null

const FIRST = 270
const TYPE = 150
const INSTANCE = 64
const DEVICE = 160
const GAP = 12
const ADD = 116
const PAD = 48 // px-6 on both sides of every row
const VALUE = 'present-value'
/** a chosen column is as wide as its longest value in the first rows, within these bounds */
const SAMPLE = 300
const CHAR = 7.2
/** a marker beside a value: its margin and padding, and its 10.5px characters */
const MARK = 18
const MARK_CHAR = 5.8
const clamp = (min: number, v: number, max: number) => Math.round(Math.min(max, Math.max(min, v)))

/** Only the Object column is fluid: when the chosen columns fit, it takes the rest and nothing scrolls sideways. */
function grid(fixed: number[]) {
  return {
    gridTemplateColumns: `minmax(${FIRST}px,1fr) ${fixed.map((w) => `${w}px`).join(' ')} ${ADD}px`,
    minWidth: FIRST + fixed.reduce((a, w) => a + w, 0) + ADD + (fixed.length + 1) * GAP + PAD,
  }
}


function SortHead({ label, column, sort, onSort, onRemove, end }: { label: string; column: string; sort: Sort; onSort: (c: string) => void; onRemove?: () => void; end?: boolean }) {
  const on = sort?.column === column
  // the remove X sits over the label on hover, so a fitted width is spent on the label, not on a hidden button
  return (
    <span className={cn('group/head relative flex min-w-0 items-center', end && 'justify-self-end')}>
    <button
      onClick={() => onSort(column)}
      title={label}
      className={cn(
        'group/sort flex min-w-0 items-center gap-1 transition-colors hover:text-(--text-strong)',
        end ? 'flex-row-reverse text-right' : 'text-left',
        on && 'text-(--text-strong)',
      )}
    >
      <span className="truncate">{label}</span>
      <ArrowUp
        className={cn(
          'size-3 shrink-0 opacity-0 transition-[opacity,rotate] duration-150 group-hover/sort:opacity-50',
          on && 'opacity-100 group-hover/sort:opacity-100',
          on && sort?.dir === -1 && 'rotate-180',
        )}
      />
    </button>
    {onRemove ? (
      <button
        aria-label={`Remove the ${label} column`}
        title="Remove column"
        onClick={onRemove}
        className={cn(
          'absolute inline-flex size-5 items-center justify-center rounded-full bg-(--surface-card-muted) text-(--text-faint) opacity-0 transition-opacity group-hover/head:opacity-100 hover:bg-(--surface-hover) hover:text-(--text-strong) focus-visible:opacity-100',
          end ? '-left-1' : '-right-1',
        )}
      >
        <XIcon className="size-3" />
      </button>
    ) : null}
    </span>
  )
}

const Cell = memo(function Cell({ row, column }: { row: ObjectRow; column: string }) {
  const c = cell(row, column)
  if (c.kind === 'missing') {
    return <span className="text-(--ink-4)" title="This object does not have this property">–</span>
  }
  if (c.kind === 'error') return <ErrorPill text={c.text} />
  return (
    <span className="block truncate tabular-nums" title={c.text.length > 24 ? c.text : undefined}>
      {c.text || <span className="text-(--ink-4)">–</span>}
    </span>
  )
})

const StatusChip = ({ status }: { status: ObjectRow['status'] }) =>
  status === 'ok' ? null : (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-px text-[11px] lowercase',
        status === 'failed' ? 'bg-(--status-alarm-bg)' : 'bg-(--status-warn-bg)',
      )}
    >
      {status}
    </span>
  )

export function ObjectTable({
  rows,
  columns,
  sort,
  onSort,
  selectedKey,
  onSelect,
  showDevice,
  loading,
  onAddColumn,
  onRemoveColumn,
  held,
  flash,
  picked,
  onPick,
  onPickAll,
}: {
  /** rows ticked for a bulk action, by key */
  picked: Set<string>
  /** tick or untick one row; range: shift was held, so everything from the last tick to here */
  onPick: (key: string, how: { range: boolean }) => void
  onPickAll: (on: boolean) => void
  /** when a live refresh last changed a row's present value, by object key; the value cell lights up once */
  flash?: Map<string, number>
  /** priority slots BACon commanded and has not released, by object key */
  held?: Map<string, { priority: number | null }[]>
  /** opens Columns, where the table's (and the export's) columns are chosen */
  onAddColumn: () => void
  onRemoveColumn: (column: string) => void
  rows: ObjectRow[]
  columns: string[]
  sort: Sort
  onSort: (column: string) => void
  selectedKey: string | null
  onSelect: (key: string) => void
  showDevice: boolean
  loading: boolean
}) {
  const shown = rows.slice(0, MAX_RENDERED_ROWS)
  const pickedShown = picked.size ? rows.filter((r) => picked.has(r.key)).length : 0
  const allPicked = rows.length > 0 && pickedShown === rows.length
  const somePicked = pickedShown > 0
  // fitted widths: each chosen column as wide as its longest value in the first rows; numbers stay narrow and sit right
  const fit = useMemo(() => {
    const sample = rows.slice(0, SAMPLE)
    return columns.map((c) => {
      let chars = c.length
      if (c === VALUE) {
        // the value as it reads, with its unit or state number, then its markers; past the cap the value truncates first
        let px = c.length * CHAR
        for (const r of sample) {
          const f = formatValue(r)
          const extra = f.kind === 'binary' ? 12 : f.kind === 'state' ? (String(f.number).length + 1) * CHAR : f.unit ? (f.unit.length + 1) * CHAR : 0
          const marks = valueMarkers(r, held?.get(r.key)).reduce((a, m) => a + MARK + m.label.length * MARK_CHAR, 0)
          px = Math.max(px, f.text.length * CHAR + extra + marks)
        }
        return { column: c, numeric: true, width: clamp(140, px + 28, 260) }
      }
      for (const r of sample) {
        const v = cell(r, c)
        // an unreadable value shows as a short chip, not its error text
        const n = v.kind === 'value' ? v.text.length : v.kind === 'error' ? 12 : 1
        if (n > chars) chars = n
      }
      const numeric = isNumericProp(rows, c)
      return { column: c, numeric, width: numeric ? clamp(88, chars * CHAR + 28, 160) : clamp(96, chars * CHAR + 28, 340) }
    })
  }, [rows, columns, held])
  // the device column is as wide as its names, up to DEVICE
  const device = useMemo(() => {
    if (!showDevice) return 0
    let chars = 6
    for (const r of rows.slice(0, SAMPLE)) chars = Math.max(chars, (r.values['Device name'] || String(r.device)).length)
    return clamp(96, chars * CHAR + 28, DEVICE)
  }, [rows, showDevice])
  const layout = grid([TYPE, INSTANCE, ...(showDevice ? [device] : []), ...fit.map((f) => f.width)])

  // once the table is scrolled sideways the pinned Object column gets an edge, so it reads as sitting on top
  const root = useRef<HTMLDivElement>(null)
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const viewport = root.current?.closest<HTMLElement>('[data-slot="scroll-area-viewport"]')
    if (!viewport) return
    const onScroll = () => setScrolled(viewport.scrollLeft > 0)
    onScroll()
    viewport.addEventListener('scroll', onScroll, { passive: true })
    return () => viewport.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <div ref={root} data-scrolled={scrolled ? 'true' : undefined} className="group/table" style={{ minWidth: layout.minWidth }}>
      <div
        className="sticky top-0 z-[2] grid h-9 items-center gap-3 border-b border-(--border-subtle) bg-(--surface-card-muted) px-6 text-[11.5px] text-(--text-muted)"
        style={layout}
      >
        <span className="sticky left-0 z-[1] -mr-3 -ml-6 flex h-full items-center gap-3.5 bg-(--surface-card-muted) pr-3 pl-6 font-medium text-(--text-strong) transition-shadow group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--border-subtle)]">
          <Tick
            state={allPicked ? true : somePicked ? 'some' : false}
            label={allPicked ? 'Untick every row' : 'Tick every row shown'}
            onClick={() => onPickAll(!allPicked)}
          />
          <SortHead label="Object" column="object-name" sort={sort} onSort={onSort} />
          <span className="-ml-2 font-normal text-(--text-faint) tabular-nums">{rows.length}</span>
        </span>
        <SortHead label="Type" column="Object type" sort={sort} onSort={onSort} />
        <SortHead label="#" column="Instance" sort={sort} onSort={onSort} end />
        {showDevice ? <SortHead label="Device" column="Device name" sort={sort} onSort={onSort} /> : null}
        {fit.map((f) => (
          <SortHead key={f.column} label={f.column} column={f.column} sort={sort} onSort={onSort} onRemove={() => onRemoveColumn(f.column)} end={f.numeric} />
        ))}
        <button
          onClick={onAddColumn}
          title="Choose the columns for the table and the export"
          className="inline-flex h-6 items-center gap-1 justify-self-start rounded-full px-2 text-[12px] text-(--text-faint) transition-colors hover:bg-(--surface-hover) hover:text-(--text-strong)"
        >
          <Plus className="size-3" />
          Add column
        </button>
      </div>

      <div>
        {loading && shown.length === 0
          ? Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="grid h-10 items-center gap-3 border-b border-(--border-divider) px-6" style={layout}>
                <span className="flex items-center gap-3.5">
                  <Skeleton className="size-4 rounded-[5px]" />
                  <Skeleton className="h-3.5 w-40" />
                </span>
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-3 w-8 justify-self-end" />
                {showDevice ? <Skeleton className="h-3 w-24" /> : null}
                {fit.map((f) => (
                  <Skeleton key={f.column} className={cn('h-3 w-16', f.numeric && 'justify-self-end')} />
                ))}
                <span />
              </div>
            ))
          : shown.map((r) => (
              <div
                key={r.key}
                data-row-key={r.key}
                role="row"
                aria-selected={selectedKey === r.key}
                data-selected={selectedKey === r.key ? 'true' : undefined}
                data-picked={picked.has(r.key) ? 'true' : undefined}
                data-flash={flash?.has(r.key) ? 'true' : undefined}
                onClick={(e) => {
                  // Ctrl/Cmd-click ticks, Shift-click ticks a range; a plain click opens the object
                  if (e.ctrlKey || e.metaKey || e.shiftKey) onPick(r.key, { range: e.shiftKey })
                  else onSelect(r.key)
                }}
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                className="bx-row-in group/row relative grid h-10 cursor-pointer items-center gap-3 border-b border-(--border-divider) px-6 transition-colors duration-150 hover:bg-(--surface-hover) data-[picked=true]:bg-(--surface-ticked) data-[selected=true]:bg-(--surface-selected)"
                style={layout}
              >
                {selectedKey === r.key ? <span aria-hidden className="absolute inset-y-0 left-0 z-[2] w-[3px] rounded-r-full bg-(--ink)" /> : null}
                <span className="sticky left-0 z-[1] -mr-3 -ml-6 flex h-full min-w-0 items-center gap-3.5 bg-(--surface-card) pr-3 pl-6 transition-[background-color,box-shadow] group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--border-subtle)] duration-150 group-hover/row:bg-(--surface-hover) group-data-[picked=true]/row:bg-(--surface-ticked) group-data-[selected=true]/row:bg-(--surface-selected)">
                  <Tick state={picked.has(r.key)} label={`Tick ${r.values['object-name'] || r.key}`} onClick={(e) => onPick(r.key, { range: e.shiftKey })} />
                  <span className="min-w-0 truncate text-[13.5px] font-medium" title={r.values['object-name'] || undefined}>
                    {r.values['object-name'] || <span className="text-(--text-faint)">Unnamed</span>}
                  </span>
                  <StatusChip status={r.status} />
                </span>
                <span className="min-w-0 truncate text-[12px] text-(--text-muted)" title={r.values['Object type']}>
                  {r.values['Object type']}
                </span>
                <span className="justify-self-end text-right text-[12px] tabular-nums text-(--text-muted)">{r.instance}</span>
                {showDevice ? (
                  <span className="min-w-0 truncate text-[12px] text-(--text-muted)" title={r.values['Device name'] || String(r.device)}>
                    {r.values['Device name'] || r.device}
                  </span>
                ) : null}
                {fit.map((f) =>
                  f.column === VALUE ? (
                    // keyed on the change, so a second change plays the flash again
                    <span key={`${f.column}:${flash?.get(r.key) ?? ''}`} className={cn('-mx-1.5 min-w-0 justify-self-stretch rounded-[6px] px-1.5 py-0.5', flash?.has(r.key) && 'bx-flash')}>
                      <ValueCell row={r} held={held?.get(r.key)} />
                    </span>
                  ) : (
                    <span key={f.column} className={cn('min-w-0 text-[12.5px]', f.numeric && 'max-w-full justify-self-end text-right')}>
                      <Cell row={r} column={f.column} />
                    </span>
                  ),
                )}
                <span />
              </div>
            ))}
        {rows.length > MAX_RENDERED_ROWS ? (
          <div className="px-6 py-3 text-[12px] text-(--text-muted)">
            The first {MAX_RENDERED_ROWS} rows are shown. Search or filter to narrow it down; exports include every matching row.
          </div>
        ) : null}
      </div>
    </div>
  )
}
