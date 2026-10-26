import type { ReactNode } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { cn } from '../ui/utils'

const { Search, XIcon } = Hugeicons

/** A labelled group in a right-hand inspector, as in Novacore's inspector panels. */
export function Group({ label, aside, children, className }: { label: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-2xl border border-(--border-subtle) bg-(--surface-card) px-4 pt-3 pb-3.5', className)}>
      <div className="mb-2 flex min-h-5 items-center gap-2">
        <h3 className="m-0 flex-1 text-[12px] font-normal text-(--text-muted)">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

/** A label and its value on one line. */
export function Detail({ label, children, title }: { label: ReactNode; children: ReactNode; title?: string }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4 text-[12.5px]" title={title}>
      <dt className="shrink-0 text-(--text-muted)">{label}</dt>
      <dd className="m-0 min-w-0 text-right tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

/** The middle of a page with nothing to show: one sentence and the one thing to do. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text: ReactNode; action?: ReactNode }) {
  return (
    <div className="nc-view-in mx-auto flex max-w-[400px] flex-col items-center px-5 py-16 text-center">
      {icon ? <div className="mb-3 inline-flex size-10 items-center justify-center rounded-[12px] bg-(--surface-track) text-(--text-muted)">{icon}</div> : null}
      <div className="text-[15px] font-medium">{title}</div>
      <div className="mt-1 text-[13px] leading-normal text-(--text-muted)">{text}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/** The left pane's title block, shared by the pages that list things. */
export function PaneTitle({ title, count }: { title: string; count?: number }) {
  return (
    <div className="flex h-12 shrink-0 flex-col justify-center px-4">
      <div className="flex items-baseline gap-1.5 text-[16px] font-medium tracking-[-0.01em]">
        {title}
        {count ? <span className="text-[12px] font-normal tabular-nums text-(--text-faint)">{count}</span> : null}
      </div>
    </div>
  )
}

/** The search field at the top of a left pane. */
export function PaneSearch({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="px-3 pb-2">
      <label className="flex h-8 min-w-0 items-center gap-2 rounded-[12px] border border-(--border-default) bg-(--surface-input) px-2.5 shadow-[0_1px_2px_rgba(0,0,0,.05)] focus-within:border-(--ring)">
        <Search className="size-3.5 shrink-0 text-(--text-faint)" />
        <Input unstyled nativeInput className="h-full min-w-0 flex-1 text-[13px]" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
        {value ? (
          <button aria-label="Clear search" onClick={() => onChange('')} className="inline-flex size-5 items-center justify-center rounded-full text-(--text-faint) hover:bg-(--surface-track) hover:text-(--text-strong)">
            <XIcon className="size-3" />
          </button>
        ) : null}
      </label>
    </div>
  )
}
