import { memo, useEffect, useRef, useState } from 'react'
import type { ObjectRow } from '../api'
import { cell } from '../exporters'
import { Hugeicons } from '../ui/components/hugeicons'
import { Skeleton } from '../ui/components/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'

const { ArrowUp, Plus, XIcon } = Hugeicons

export const MAX_RENDERED_ROWS = 2000
export type Sort = { column: string; dir: 1 | -1 } | null

const FIRST = 260
const COL = 170
const GAP = 12
const ADD = 116

function grid(n: number) {
  return {
    gridTemplateColumns: `minmax(${FIRST}px,1.3fr) repeat(${n}, minmax(${COL}px,1fr)) ${ADD}px`,
    minWidth: FIRST + n * (COL + GAP) + ADD + GAP + 36,
  }
}


function SortHead({ label, column, sort, onSort, onRemove }: { label: string; column: string; sort: Sort; onSort: (c: string) => void; onRemove?: () => void }) {
  const on = sort?.column === column
  return (
    <span className="group/head flex min-w-0 items-center gap-1">
    <button
      onClick={() => onSort(column)}
      title={label}
      className={cn(
        'group/sort flex min-w-0 items-center gap-1 text-left transition-colors hover:text-(--text-strong)',
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
        className="ml-auto inline-flex size-5 shrink-0 items-center justify-center rounded-full text-(--text-faint) opacity-0 transition-opacity group-hover/head:opacity-100 hover:bg-(--surface-hover) hover:text-(--text-strong) focus-visible:opacity-100"
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

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex h-[18px] shrink-0 items-center rounded-full bg-(--surface-track) px-2 text-[11px] leading-none tabular-nums text-(--text-muted)', className)}>
      <span className="truncate">{children}</span>
    </span>
  )
}

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
}: {
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
  const layout = grid(columns.length)
  const shown = rows.slice(0, MAX_RENDERED_ROWS)

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
        className="sticky top-0 z-[2] grid items-center gap-3 border-t border-(--border-divider) bg-(--surface-card-muted) px-4 py-1.5 text-[11.5px] text-(--text-muted)"
        style={layout}
      >
        <span className="sticky left-0 z-[1] -my-1.5 -mr-3 -ml-4 bg-(--surface-card-muted) py-1.5 pr-3 pl-4 transition-shadow group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--border-subtle)]">
          <SortHead label="Object" column="object-name" sort={sort} onSort={onSort} />
        </span>
        {columns.map((c) => (
          <SortHead key={c} label={c} column={c} sort={sort} onSort={onSort} onRemove={() => onRemoveColumn(c)} />
        ))}
        <button
          onClick={onAddColumn}
          className="inline-flex h-6 items-center gap-1 justify-self-start rounded-full border border-dashed border-(--border-strong) bg-(--surface-card) px-2.5 text-[11.5px] text-(--text-muted) transition-colors hover:border-solid hover:text-(--text-strong)"
        >
          <Plus className="size-3" />
          Add column
        </button>
      </div>

      <div>
        {loading && shown.length === 0
          ? Array.from({ length: 9 }, (_, i) => (
              <div key={i} className="grid h-[52px] items-center gap-3 border-t border-(--border-divider) px-4" style={layout}>
                <span className="flex flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-40" />
                  <Skeleton className="h-2.5 w-24" />
                </span>
                {columns.map((c) => (
                  <Skeleton key={c} className="h-3 w-20" />
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
                className="bx-row-in group/row relative grid h-[52px] cursor-pointer items-center gap-3 border-t border-(--border-divider) px-4 transition-colors duration-150 hover:bg-(--surface-hover) data-[selected=true]:bg-(--surface-hover)"
                style={layout}
              >
                <span className="sticky left-0 z-[1] -mr-3 -ml-4 flex h-full min-w-0 items-center gap-2 bg-(--surface-card) pr-3 pl-4 transition-[background-color,box-shadow] group-data-[scrolled=true]/table:shadow-[1px_0_0_var(--border-subtle)] duration-150 group-hover/row:bg-(--surface-hover) group-data-[selected=true]/row:bg-(--surface-hover)">
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate text-[13px] leading-4 font-medium">{r.values['object-name'] || <span className="text-(--text-faint)">Unnamed</span>}</span>
                    <span className="flex min-w-0 items-center gap-1">
                      <Tag>{r.values['Object type']}</Tag>
                      <Tag>#{r.instance}</Tag>
                      {showDevice ? <Tag className="min-w-0 shrink">{r.values['Device name'] || r.device}</Tag> : null}
                    </span>
                  </span>
                  <StatusChip status={r.status} />
                </span>
                {columns.map((c) => (
                  <span key={c} className="min-w-0 text-[12.5px]">
                    <Cell row={r} column={c} />
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
