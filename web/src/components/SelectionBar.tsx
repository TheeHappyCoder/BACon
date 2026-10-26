import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'

const { PencilEdit: Pencil, LineChart, ReloadIcon, Download, XIcon } = Hugeicons

function Action({ icon, label, onClick, disabled, why }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; why?: string }) {
  const button = (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap text-white outline-none transition-colors hover:bg-white/12 focus-visible:ring-2 focus-visible:ring-white/35 disabled:pointer-events-none disabled:text-white/35 [&_svg]:size-[15px]"
    >
      {icon}
      {label}
    </button>
  )
  if (!disabled || !why) return button
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
      <TooltipPopup side="top">{why}</TooltipPopup>
    </Tooltip>
  )
}

/**
 * The ticked rows' actions, floating over the bottom of the table: write, trend, read again and export act on those
 * rows only. Esc or the cross unticks them.
 */
export function SelectionBar({
  count,
  hidden,
  writable,
  canWrite,
  onWrite,
  onTrend,
  onReread,
  onExport,
  onClear,
}: {
  count: number
  /** ticked rows the current filter hides */
  hidden: number
  writable: number
  canWrite: boolean
  onWrite: () => void
  onTrend: () => void
  onReread: () => void
  onExport: () => void
  onClear: () => void
}) {
  return (
    <AnimatePresence>
      {count > 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 520, damping: 38 }}
          role="toolbar"
          aria-label="Ticked rows"
          className="pointer-events-auto absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-(--pill-dark) p-1 text-white shadow-[0_12px_32px_-8px_rgba(0,0,0,.35),0_2px_6px_rgba(0,0,0,.12)]"
        >
          <span className="flex items-center gap-2 pr-2 pl-1.5 text-[13px] whitespace-nowrap">
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-(--color-ns-green) px-2 text-[12px] font-medium tabular-nums text-(--ink)">{count}</span>
            <span className="font-medium">ticked</span>
            {hidden ? <span className="text-white/50">{hidden} hidden by the filter</span> : null}
          </span>
          <span className="mx-1 h-4 w-px bg-white/15" />
          <Action
            icon={<Pencil />}
            label={writable && writable < count ? `Write ${writable}…` : 'Write…'}
            onClick={onWrite}
            disabled={!canWrite || !writable}
            why={!canWrite ? 'Connect to the network to write' : 'None of these can be written'}
          />
          <Action icon={<LineChart />} label="Trend" onClick={onTrend} />
          <Action icon={<ReloadIcon />} label="Read again" onClick={onReread} disabled={!canWrite} why="Connect to the network to read" />
          <Action icon={<Download />} label="Export…" onClick={onExport} />
          <span className="mx-1 h-4 w-px bg-white/15" />
          <button
            aria-label="Untick every row"
            title="Untick every row · Esc"
            onClick={onClear}
            className="inline-flex size-8 items-center justify-center rounded-full text-white/70 outline-none transition-colors hover:bg-white/12 hover:text-white focus-visible:ring-2 focus-visible:ring-white/35"
          >
            <XIcon className="size-4" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
