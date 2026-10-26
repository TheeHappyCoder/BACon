import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { cn } from '../ui/utils'
import { Pane, useLayout } from './Layout'

const { XIcon } = Hugeicons

const EASE = [0.2, 0.8, 0.2, 1] as const

/**
 * The right-hand panel every page uses for the thing picked on it. It grows in from the edge when something is picked,
 * crossfades when another thing is picked, and slides away when closed, keeping what it showed until it is gone.
 * Build its content from PanelHeader, PanelBody and PanelFooter.
 */
export function SidePanel({ open, subjectKey, children }: { open: boolean; /** changes when another thing is shown */ subjectKey?: string; children: ReactNode }) {
  const { setCollapsed } = useLayout()
  // picking something shows it, even if the panel was folded away on this page or another
  useEffect(() => {
    if (open) setCollapsed('right', false)
  }, [open, subjectKey, setCollapsed])
  const [mounted, setMounted] = useState(open)
  const [kept, setKept] = useState({ children, subjectKey })
  if (open && !mounted) setMounted(true)
  // what was on show stays while the panel slides away
  if (open && (kept.children !== children || kept.subjectKey !== subjectKey)) setKept({ children, subjectKey })
  if (!mounted) return null
  const shown = open ? { children, subjectKey } : kept
  return (
    <Pane side="right" open={open} onHidden={() => setMounted(false)}>
      <aside className="relative flex w-full min-w-0 flex-col overflow-hidden bg-(--surface-card)">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={shown.subjectKey ?? 'panel'}
            className="flex min-h-0 w-full flex-1 flex-col"
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0, transition: { duration: 0.26, ease: EASE } }}
            exit={{ opacity: 0, x: -10, transition: { duration: 0.14, ease: 'easeIn' } }}
          >
            {shown.children}
          </motion.div>
        </AnimatePresence>
      </aside>
    </Pane>
  )
}

/** What the panel shows: a small line of where it is, its name, and the close button. Tabs go in children. */
export function PanelHeader({ eyebrow, title, onClose, closeLabel = 'Close', children }: { eyebrow?: ReactNode; title: ReactNode; onClose?: () => void; closeLabel?: string; children?: ReactNode }) {
  return (
    <div className="shrink-0">
      <div className="flex items-start gap-3 px-[18px] pt-4 pb-3">
        <div className="min-w-0 flex-1">
          {eyebrow ? <div className="truncate text-[11px] text-(--text-faint)">{eyebrow}</div> : null}
          <div className="mt-0.5 truncate text-[17px] font-medium tracking-[-0.01em]">{title}</div>
        </div>
        {onClose ? (
          <Button aria-label={closeLabel} title="Close" variant="secondary" size="icon-xs" onClick={onClose}>
            <XIcon />
          </Button>
        ) : null}
      </div>
      {children ? <div className="px-[18px] pb-2">{children}</div> : null}
    </div>
  )
}

/** The panel's scrolling middle. Padded, its parts stack with a small gap; unpadded, the content lays itself out. */
export function PanelBody({ children, padded = true, className }: { children: ReactNode; padded?: boolean; className?: string }) {
  return (
    <ScrollArea scrollFade className="min-h-0 flex-1">
      {padded ? <div className={cn('flex flex-col gap-2.5 px-[18px] pt-1 pb-4', className)}>{children}</div> : children}
    </ScrollArea>
  )
}

/** The panel's actions, on its bottom edge, right-aligned. */
export function PanelFooter({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-(--border-subtle) px-[18px] py-3">{children}</div>
}
