import { useMemo, useState } from 'react'
import type { ObjectRow } from '../api'
import { DEFAULT_COLUMNS, SYNTHETIC_COLUMNS } from '../exporters'
import { Button } from '../ui/components/button'
import { Checkbox } from '../ui/components/checkbox'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '../ui/components/sheet'
import { cn } from '../ui/utils'
import { useToast } from './Toasts'

const { ArrowUp, ArrowDown, XIcon, Undo, Bookmark, ChevronDown } = Hugeicons

/**
 * The one place columns are chosen. The table's columns are the export's columns, and they apply to every device, so
 * the list is built from every object read, not from what the tree has selected. Each property shows how many objects
 * have it.
 */
export function ColumnsSheet({
  open,
  onOpenChange,
  allRows,
  columns,
  onColumns,
  presets,
  onPresets,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** every object of every visible device, regardless of what the tree has selected */
  allRows: ObjectRow[]
  columns: string[]
  onColumns: (c: string[]) => void
  presets: Record<string, string[]>
  onPresets: (p: Record<string, string[]>) => void
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')

  // how many objects have each property; a name only ever seen as an error counts 0
  const { counts, errorOnly } = useMemo(() => {
    const counts = new Map<string, number>()
    const seenErrors = new Set<string>()
    for (const r of allRows) {
      for (const k of Object.keys(r.values)) counts.set(k, (counts.get(k) ?? 0) + 1)
      for (const k of Object.keys(r.errors)) {
        seenErrors.add(k)
        if (!counts.has(k)) counts.set(k, 0)
      }
    }
    for (const k of SYNTHETIC_COLUMNS) counts.delete(k)
    const errorOnly = new Set([...seenErrors].filter((k) => counts.get(k) === 0))
    return { counts, errorOnly }
  }, [allRows])
  const total = allRows.length

  const ticked = useMemo(() => new Set(columns), [columns])
  const q = query.trim().toLowerCase()
  const match = (name: string) => !q || name.toLowerCase().includes(q)
  const chosen = columns.filter(match)
  const unticked = [...counts.keys()].filter((name) => !ticked.has(name) && match(name)).sort((a, b) => a.localeCompare(b))
  const vendor = unticked.filter((name) => name.includes('['))
  const standard = unticked.filter((name) => !name.includes('['))

  const toggle = (name: string) => onColumns(ticked.has(name) ? columns.filter((c) => c !== name) : [...columns, name])
  const move = (i: number, d: number) => {
    const next = [...columns]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onColumns(next)
  }

  const coverage = (name: string) => {
    const n = counts.get(name) ?? 0
    const text = n === 0 && errorOnly.has(name) ? `0 of ${total} · unreadable` : `${n} of ${total}`
    return (
      <span className="shrink-0 text-[11px] tabular-nums text-(--text-faint)" title={`${n} of ${total} objects on every device have this property`}>
        {text}
      </span>
    )
  }

  const renderRow = (name: string, index?: number) => {
    const on = ticked.has(name)
    const n = counts.get(name) ?? 0
    return (
      <div
        key={name}
        className={cn(
          'group/prop grid min-h-9 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[9px] px-2 py-1 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]',
          on && 'bg-(--surface-checked) hover:bg-(--surface-checked)',
        )}
      >
        <Checkbox checked={on} onCheckedChange={() => toggle(name)} aria-label={on ? `Remove the ${name} column` : `Add ${name} as a column`} />
        <span className="flex min-w-0 flex-col gap-1">
          <button className="min-w-0 truncate text-left text-[13px]" title={name} onClick={() => toggle(name)}>
            {name}
          </button>
          <div className="h-[2px] rounded-full bg-(--surface-track)">
            <div className="h-full rounded-full bg-(--ink-4)" style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
          </div>
        </span>
        <span className="flex min-w-0 items-center justify-end gap-1">
          {index !== undefined ? (
            <span className="hidden shrink-0 group-hover/prop:flex">
              <Button aria-label="Move up" variant="ghost" size="icon-xs" className="size-6" disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp />
              </Button>
              <Button aria-label="Move down" variant="ghost" size="icon-xs" className="size-6" disabled={index === columns.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown />
              </Button>
            </span>
          ) : null}
          <span className={cn('flex min-w-0 justify-end', index !== undefined && 'group-hover/prop:hidden')}>{coverage(name)}</span>
        </span>
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetPopup side="right" className="max-w-[520px]">
        <SheetHeader className="border-b border-(--border-subtle) px-5 py-5 pr-14">
          <SheetTitle>Columns</SheetTitle>
          <SheetDescription>The table's columns and every export's columns, for every device.</SheetDescription>
        </SheetHeader>
        <SheetPanel className="px-3 py-3">
          <div className="px-2">
            <Input size="sm" placeholder="Find a property, e.g. address, units, 3019" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="flex flex-col pb-2">
            {renderSection('Chosen, in this order', 'reorder with the arrows', !chosen.length, chosen.map((name) => renderRow(name, columns.indexOf(name))))}
            {renderSection('Vendor-specific', 'not in an EDE export', !vendor.length, vendor.map((name) => renderRow(name)))}
            {renderSection('Standard', undefined, !standard.length, standard.map((name) => renderRow(name)))}
            {!chosen.length && !vendor.length && !standard.length ? (
              <p className="m-0 px-2 py-6 text-center text-[12px] text-(--text-muted)">No property matches. Try a shorter search.</p>
            ) : null}
          </div>
        </SheetPanel>

        {naming ? (
          <form
            className="flex gap-2 border-t border-(--border-subtle) px-5 py-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              const name = presetName.trim()
              if (!name) return
              onPresets({ ...presets, [name]: columns })
              toast(`Saved preset "${name}"`)
              setPresetName('')
              setNaming(false)
            }}
          >
            <Input autoFocus size="sm" placeholder="Preset name, e.g. IO list" value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            <Button type="submit" size="xs" className="h-7" disabled={!presetName.trim()}>
              Save
            </Button>
            <Button type="button" size="xs" variant="ghost" className="h-7" onClick={() => setNaming(false)}>
              Cancel
            </Button>
          </form>
        ) : null}

        <SheetFooter className="justify-between sm:justify-between">
          <Menu>
            <MenuTrigger render={<Button size="sm" variant="secondary" />}>
              <Bookmark />
              Presets
              <ChevronDown />
            </MenuTrigger>
            <MenuPopup align="start" side="top" className="w-60">
              {Object.keys(presets).length ? (
                <MenuGroup>
                  <MenuGroupLabel>Apply a saved set of columns</MenuGroupLabel>
                  {Object.keys(presets).map((name) => (
                    <MenuItem key={name} onClick={() => onColumns(presets[name])}>
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <span className="text-[11px] text-(--text-faint)">{presets[name].length}</span>
                    </MenuItem>
                  ))}
                </MenuGroup>
              ) : null}
              {Object.keys(presets).length ? <MenuSeparator /> : null}
              <MenuItem onClick={() => setNaming(true)} disabled={!columns.length}>
                <Bookmark />
                Save these columns as a preset
              </MenuItem>
              <MenuItem
                onClick={() => {
                  const previous = columns
                  onColumns(DEFAULT_COLUMNS)
                  toast('Columns reset to the default', { undo: () => onColumns(previous) })
                }}
              >
                <Undo />
                Reset to the default columns
              </MenuItem>
              {Object.keys(presets).length ? (
                <>
                  <MenuSeparator />
                  <MenuGroup>
                    <MenuGroupLabel>Delete a preset</MenuGroupLabel>
                    {Object.keys(presets).map((name) => (
                      <MenuItem
                        key={name}
                        variant="destructive"
                        onClick={() => {
                          const previous = presets[name]
                          const next = { ...presets }
                          delete next[name]
                          onPresets(next)
                          toast(`Deleted preset "${name}"`, { undo: () => onPresets({ ...next, [name]: previous }) })
                        }}
                      >
                        <XIcon />
                        {name}
                      </MenuItem>
                    ))}
                  </MenuGroup>
                </>
              ) : null}
            </MenuPopup>
          </Menu>
          <span className="flex items-center gap-3">
            <span className="text-[12px] text-(--text-muted)">
              {columns.length} column{columns.length === 1 ? '' : 's'}
            </span>
            <Button size="sm" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </span>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  )
}
