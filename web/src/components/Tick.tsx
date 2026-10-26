import type React from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { cn } from '../ui/utils'

const { Check } = Hugeicons

/** The row's checkbox. Its own control so a shift-click can pick a range. */
export function Tick({ state, label, onClick, disabled }: { state: boolean | 'some'; label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : state}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      onMouseDown={(e) => e.shiftKey && e.preventDefault()}
      className={cn(
        'relative inline-flex size-4 shrink-0 disabled:opacity-50 items-center justify-center rounded-[5px] border outline-none transition-[background-color,border-color,opacity] duration-150 focus-visible:ring-2 focus-visible:ring-ring/50',
        state ? 'border-(--ink) bg-(--color-ns-green) text-(--ink)' : 'border-(--border-strong) bg-(--surface-card) hover:border-(--text-muted)',
      )}
    >
      {state === 'some' ? <span className="h-[1.5px] w-2 rounded-full bg-(--ink)" /> : state ? <Check className="size-3" strokeWidth={2.5} /> : null}
    </button>
  )
}
