import { Combobox, ComboboxEmpty, ComboboxList, ComboboxPopup, ComboboxPrimitive, ComboboxTrigger } from '../ui/components/combobox'
import { Hugeicons } from '../ui/components/hugeicons'
import { cn } from '../ui/utils'
import { typeIcon } from './typeIcon'

const { ChevronDown, Check, Search, Shapes } = Hugeicons

/**
 * The object types to show: none picked is every type. A search box on top, each type with its icon and count, ticked
 * in lime; pick one or several.
 */
export function TypePicker({ counts, value, onChange }: { counts: [string, number][]; value: string[]; onChange: (types: string[]) => void }) {
  const items = counts.map(([t]) => t)
  const countOf = new Map(counts)
  const shown = value.filter((t) => countOf.has(t))
  const total = shown.reduce((n, t) => n + (countOf.get(t) ?? 0), 0)
  return (
    <Combobox items={items} multiple value={shown} onValueChange={(v) => onChange(v as string[])}>
      <ComboboxTrigger
        aria-label="Object types"
        className={cn(
          'inline-flex h-8 max-w-[340px] shrink-0 items-center gap-2 rounded-full pr-2.5 pl-3 text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
          shown.length ? 'bg-(--ink) text-white hover:bg-(--pill-dark-hover)' : 'bg-(--surface-card) text-(--text-strong) shadow-[0_0_0_1px_var(--border-default)] hover:shadow-[0_0_0_1px_var(--border-strong)]',
        )}
      >
        <span className={cn('flex [&_svg]:size-3.5', shown.length ? 'text-(--color-ns-green)' : 'text-(--text-faint)')}>
          {shown.length === 1 ? typeIcon(shown[0]) : <Shapes />}
        </span>
        <span className="min-w-0 truncate font-medium">
          {!shown.length ? 'All types' : shown.length === 1 ? shown[0] : `${shown.length} types`}
        </span>
        <span className={cn('tabular-nums', shown.length ? 'text-white/55' : 'text-(--text-faint)')}>{shown.length ? total : counts.reduce((n, [, c]) => n + c, 0)}</span>
        <ChevronDown className={cn('size-3.5', shown.length ? 'text-white/55' : 'text-(--text-faint)')} />
      </ComboboxTrigger>
      <ComboboxPopup className="w-[300px] rounded-[14px] bg-(--surface-popover) shadow-(--shadow-popover)">
        <div className="flex items-center gap-2 border-b border-(--border-divider) px-3">
          <Search className="size-3.5 shrink-0 text-(--text-faint)" />
          <ComboboxPrimitive.Input placeholder="Find a type" className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-(--text-faint)" />
        </div>
        <ComboboxEmpty className="text-[12.5px] text-(--text-muted)">No type matches.</ComboboxEmpty>
        <ComboboxList className="max-h-[300px]">
          {(type: string) => (
            <ComboboxPrimitive.Item
              key={type}
              value={type}
              className="group/item flex h-9 cursor-default items-center gap-2.5 rounded-[9px] px-2 text-[13px] outline-none select-none data-highlighted:bg-(--surface-hover)"
            >
              <span className="relative inline-flex size-4 shrink-0 items-center justify-center rounded-[5px] border border-(--border-strong) bg-(--surface-card) group-data-selected/item:border-(--ink) group-data-selected/item:bg-(--color-ns-green)">
                <Check className="hidden size-3 text-(--ink) group-data-selected/item:block" strokeWidth={2.5} />
              </span>
              <span className="flex text-(--text-faint) [&_svg]:size-3.5">{typeIcon(type)}</span>
              <span className="min-w-0 flex-1 truncate">{type}</span>
              <span className="text-[12px] tabular-nums text-(--text-faint)">{countOf.get(type)}</span>
            </ComboboxPrimitive.Item>
          )}
        </ComboboxList>
        <div className="flex items-center justify-between border-t border-(--border-divider) px-3 py-2 text-[12px] text-(--text-muted)">
          <span className="tabular-nums">{shown.length ? `${shown.length} of ${counts.length} picked` : `${counts.length} types`}</span>
          <button type="button" disabled={!shown.length} onClick={() => onChange([])} className="rounded-full px-2 py-0.5 font-medium text-(--text-strong) hover:bg-(--surface-track) disabled:opacity-40">
            Show every type
          </button>
        </div>
      </ComboboxPopup>
    </Combobox>
  )
}
