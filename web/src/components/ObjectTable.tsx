import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectRow } from '../api'
import { cell } from '../exporters'
import { isNumericProp } from '../query'
import { Hugeicons } from '../ui/components/hugeicons'
import { Skeleton } from '../ui/components/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'

const { ArrowUp, Plus, XIcon } = Hugeicons

export const MAX_RENDERED_ROWS = 2000
export type Sort = { column: string; dir: 1 | -1 } | null

const FIRST = 240
const TYPE = 150
const INSTANCE = 64
const DEVICE = 160
const GAP = 12
const ADD = 116
const PAD = 32 // px-4 on both sides of every row
/** a chosen column is as wide as its longest value in the first rows, within these bounds */
const SAMPLE = 300
const CHAR = 7.2
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
  if (c.kind === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex max-w-full items-center rounded-full bg-(--status-alarm-bg) px-2 py-px text-[11.5px]" />}>
          <span className="truncate">unreadable</span>
        </TooltipTrigger>
        <TooltipPopup>{c.text}</TooltipPopup>
      </Tooltip>
    )
  }
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
}: {
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
  // fitted widths: each chosen column as wide as its longest value in the first rows; numbers stay narrow and sit right
  const fit = useMemo(() => {
    const sample = rows.slice(0, SAMPLE)
    return columns.map((c) => {
      let chars = c.length
      for (const r of sample) {
        const v = cell(r, c)
        // an unreadable value shows as a short chip, not its error text
        const n = v.kind === 'value' ? v.text.length : v.kind === 'error' ? 12 : 1
        if (n > chars) chars = n
      }
      const numeric = isNumericProp(rows, c)
      return { column: c, numeric, width: numeric ? clamp(88, chars * CHAR + 28, 160) : clamp(96, chars * CHAR + 28, 340) }
    })
  }, [rows, columns])
  const layout = grid([TYPE, INSTANCE, ...(showDevice ? [DEVICE] : []), ...fit.map((f) => f.width)])

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
        className="sticky top-0 z-[2] grid items-center gap-3 border-t border-(--border-divider) bg-(--surface-card-muted) px-4 py-1 text-[11.5px] text-(--text-muted)"
        style={layout}
      >
        <span className="sticky left-0 z-[1] -my-1 -mr-3 -ml-4 bg-(--surface-card-muted) py-1 pr-3 pl-4 transition-shadow group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--border-subtle)]">
          <SortHead label="Object" column="object-name" sort={sort} onSort={onSort} />
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
          className="inline-flex h-6 items-center gap-1 justify-self-start rounded-full border border-dashed border-(--border-strong) bg-(--surface-card) px-2.5 text-[11.5px] text-(--text-muted) transition-colors hover:border-solid hover:text-(--text-strong)"
        >
          <Plus className="size-3" />
          Add column
        </button>
      </div>

      <div>
        {loading && shown.length === 0
          ? Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="grid h-[38px] items-center gap-3 border-t border-(--border-divider) px-4" style={layout}>
                <Skeleton className="h-3.5 w-40" />
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
                onClick={() => onSelect(r.key)}
                className="bx-row-in group/row relative grid h-[38px] cursor-pointer items-center gap-3 border-t border-(--border-divider) px-4 transition-colors duration-150 hover:bg-(--surface-hover) data-[selected=true]:bg-(--surface-hover)"
                style={layout}
              >
                <span className="sticky left-0 z-[1] -mr-3 -ml-4 flex h-full min-w-0 items-center gap-2 bg-(--surface-card) pr-3 pl-4 transition-[background-color,box-shadow] group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--border-subtle)] duration-150 group-hover/row:bg-(--surface-hover) group-data-[selected=true]/row:bg-(--surface-hover)">
                  <span className="min-w-0 truncate text-[13px] font-medium" title={r.values['object-name'] || undefined}>
                    {r.values['object-name'] || <span className="text-(--text-faint)">Unnamed</span>}
                  </span>
                  <StatusChip status={r.status} />
                  {held?.has(r.key) ? (
                    <span title="BACon commanded this point and has not released it" className="inline-flex h-[18px] shrink-0 items-center rounded-full bg-(--status-info-bg) px-1.5 text-[10.5px] leading-none text-(--text-strong)">
                      BACon P{held.get(r.key)!.map((h) => h.priority).join(', P')}
                    </span>
                  ) : null}
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
                {fit.map((f) => (
                  <span key={f.column} className={cn('min-w-0 text-[12.5px]', f.numeric && 'max-w-full justify-self-end text-right')}>
                    <Cell row={r} column={f.column} />
                  </span>
                ))}
                <span />
              </div>
            ))}
        {rows.length > MAX_RENDERED_ROWS ? (
          <div className="border-t border-(--border-divider) px-4 py-3 text-[12px] text-(--text-muted)">
            The first {MAX_RENDERED_ROWS} rows are shown. Search or filter to narrow it down; exports include every matching row.
          </div>
        ) : null}
      </div>
    </div>
  )
}
