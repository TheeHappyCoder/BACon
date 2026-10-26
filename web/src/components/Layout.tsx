import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'

const { PanelLeft, PanelRight } = Hugeicons

type Side = 'left' | 'right'
type PaneState = { width: number; collapsed: boolean }
type LayoutState = Record<Side, PaneState>

const LIMITS: Record<Side, { min: number; max: number; initial: number }> = {
  left: { min: 220, max: 480, initial: 300 },
  right: { min: 280, max: 620, initial: 360 },
}
const KEY = 'bx.layout'

type Ctx = {
  state: LayoutState
  setWidth: (side: Side, w: number) => void
  setCollapsed: (side: Side, c: boolean) => void
  toggle: (side: Side) => void
}
const LayoutContext = createContext<Ctx | null>(null)

export function useLayout(): Ctx {
  const ctx = useContext(LayoutContext)
  if (!ctx) throw new Error('useLayout outside LayoutProvider')
  return ctx
}

/** One layout for every page: widths and collapsed state are shared and remembered. Ctrl+B and Ctrl+Alt+B toggle. */
export function LayoutProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LayoutState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null')
      if (saved?.left && saved?.right) return saved
    } catch {
      /* default below */
    }
    return { left: { width: LIMITS.left.initial, collapsed: false }, right: { width: LIMITS.right.initial, collapsed: false } }
  })
  useEffect(() => localStorage.setItem(KEY, JSON.stringify(state)), [state])

  const setWidth = useCallback((side: Side, w: number) => {
    const { min, max } = LIMITS[side]
    setState((s) => ({ ...s, [side]: { ...s[side], width: Math.round(Math.min(max, Math.max(min, w))) } }))
  }, [])
  const setCollapsed = useCallback((side: Side, c: boolean) => setState((s) => ({ ...s, [side]: { ...s[side], collapsed: c } })), [])
  const toggle = useCallback((side: Side) => setState((s) => ({ ...s, [side]: { ...s[side], collapsed: !s[side].collapsed } })), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'b' || e.shiftKey) return
      e.preventDefault()
      toggle(e.altKey ? 'right' : 'left')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  const value = useMemo(() => ({ state, setWidth, setCollapsed, toggle }), [state, setWidth, setCollapsed, toggle])
  return <LayoutContext.Provider value={value}>{children}</LayoutContext.Provider>
}

/**
 * A side pane with a drag edge. The content keeps its width while the pane opens or closes, so nothing reflows
 * mid-animation. Dragging well past the minimum closes it; double-clicking the edge resets the width.
 * `gap` is the flex gap beside the pane, pulled back when collapsed so the main sheet reaches the edge.
 */
export function Pane({ side, children, className, gap = 0 }: { side: Side; children: ReactNode; className?: string; gap?: number }) {
  const { state, setWidth, setCollapsed } = useLayout()
  const { width, collapsed } = state[side]
  const [dragging, setDragging] = useState(false)
  const start = useRef({ x: 0, w: 0 })
  const { min, max, initial } = LIMITS[side]
  const dir = side === 'left' ? 1 : -1

  return (
    <div
      className={cn('relative flex shrink-0', className)}
      data-pane={side}
      data-open={collapsed ? undefined : ''}
      style={{
        width: collapsed ? 0 : width,
        [side === 'left' ? 'marginRight' : 'marginLeft']: collapsed ? -gap : 0,
        transition: dragging ? 'none' : 'width 240ms cubic-bezier(.2,.8,.2,1), margin 240ms cubic-bezier(.2,.8,.2,1)',
      }}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      {/* clip the content while closed or closing; the drag edge sits outside this clip */}
      <div className="h-full min-h-0 w-full overflow-hidden">
        <div className={cn('flex h-full min-h-0', side === 'right' && 'ml-auto')} style={{ width: collapsed ? width : '100%', minWidth: collapsed ? width : undefined }}>
          {children}
        </div>
      </div>
      {!collapsed ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={side === 'left' ? 'Resize the sidebar' : 'Resize the details panel'}
          aria-valuenow={width}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          title="Drag to resize · double-click to reset"
          onPointerDown={(e) => {
            e.preventDefault()
            ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
            start.current = { x: e.clientX, w: width }
            setDragging(true)
            document.body.style.cursor = 'col-resize'
          }}
          onPointerMove={(e) => {
            if (!dragging) return
            const w = start.current.w + (e.clientX - start.current.x) * dir
            if (w < min - 70) {
              setCollapsed(side, true)
              setDragging(false)
              document.body.style.cursor = ''
              setWidth(side, start.current.w)
              return
            }
            setWidth(side, w)
          }}
          onPointerUp={() => {
            setDragging(false)
            document.body.style.cursor = ''
          }}
          onDoubleClick={() => setWidth(side, initial)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setWidth(side, width - 16 * dir)
            if (e.key === 'ArrowRight') setWidth(side, width + 16 * dir)
          }}
          className={cn(
            'group/edge absolute top-0 bottom-0 z-20 flex w-[10px] cursor-col-resize justify-center outline-none',
            side === 'left' ? '-right-[5px]' : '-left-[10px]',
            side === 'right' && gap < 10 && '-left-[5px]',
          )}
        >
          <span
            className={cn(
              'h-full w-px transition-colors duration-150 group-hover/edge:bg-(--border-strong) group-focus-visible/edge:bg-(--ring)',
              dragging && 'bg-(--ring) group-hover/edge:bg-(--ring)',
            )}
          />
        </div>
      ) : null}
    </div>
  )
}

/** The command bar's panel toggles: one at each end, like an IDE. */
export function PaneToggle({ side }: { side: Side }) {
  const { state, toggle } = useLayout()
  const open = !state[side].collapsed
  const Icon = side === 'left' ? PanelLeft : PanelRight
  const label = `${open ? 'Hide' : 'Show'} the ${side === 'left' ? 'sidebar' : 'details panel'}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            aria-pressed={open}
            onClick={() => toggle(side)}
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-[9px] text-(--text-muted) transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-(--text-strong)"
          />
        }
      >
        <Icon className="size-[18px]" />
      </TooltipTrigger>
      <TooltipPopup side="bottom">
        {label} · {side === 'left' ? 'Ctrl+B' : 'Ctrl+Alt+B'}
      </TooltipPopup>
    </Tooltip>
  )
}
