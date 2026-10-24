import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObjectRow } from '../api'
import { DEFAULT_COLUMNS, SYNTHETIC_COLUMNS } from '../exporters'
import { Button } from '../ui/components/button'
import { Checkbox } from '../ui/components/checkbox'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { ScrollArea } from '../ui/components/scroll-area'
import { cn } from '../ui/utils'
import { useToast } from './Toasts'

const { ArrowUp, ArrowDown, XIcon, Undo, Bookmark, ChevronDown, Search, LineChart } = Hugeicons

type Prop = { name: string; count: number }

/**
 * YABE's property grid with one addition: every property has a tick box, and a ticked property is a column in the
 * table and the export. With an object picked it shows that object's values; otherwise how many objects have each one.
 */
export function PropertiesPanel({
  subject,
  subjectLabel,
  available,
  totalRows,
  columns,
  onColumns,
  presets,
  onPresets,
  onClearSubject,
  onReread,
  canRead,
  focusSignal,
  onTrend,
  trendLabel,
  trended,
}: {
  onTrend?: () => void
  /** the button's words, when it is not "Trend" (a trend log shows its history) */
  trendLabel?: string
  trended?: boolean
  subject: ObjectRow | null
  subjectLabel: string
  available: Prop[]
  totalRows: number
  columns: string[]
  onColumns: (c: string[]) => void
  presets: Record<string, string[]>
  onPresets: (p: Record<string, string[]>) => void
  onClearSubject: () => void
  onReread: () => void
  canRead: boolean
  focusSignal: number
}) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [naming, setNaming] = useState(false)
  const [presetName, setPresetName] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (focusSignal) searchRef.current?.focus()
  }, [focusSignal])

  const ticked = useMemo(() => new Set(columns), [columns])
  const names = useMemo(() => {
    if (!subject) return available
    const own = [...new Set([...Object.keys(subject.values), ...Object.keys(subject.errors)])]
    const counts = new Map(available.map((p) => [p.name, p.count]))
    return own.map((name) => ({ name, count: counts.get(name) ?? 1 }))
  }, [subject, available])

  const q = query.trim().toLowerCase()
  const match = (p: Prop) => !q || p.name.toLowerCase().includes(q) || (subject?.values[p.name] ?? '').toLowerCase().includes(q)
  const list = names.filter(match).filter((p) => !SYNTHETIC_COLUMNS.includes(p.name))
  const exporting = columns.filter((c) => !q || c.toLowerCase().includes(q))
  const vendor = list.filter((p) => p.name.includes('[') && !ticked.has(p.name)).sort((a, b) => a.name.localeCompare(b.name))
  const standard = list.filter((p) => !p.name.includes('[') && !ticked.has(p.name)).sort((a, b) => a.name.localeCompare(b.name))

  const toggle = (name: string) => onColumns(ticked.has(name) ? columns.filter((c) => c !== name) : [...columns, name])
  const move = (i: number, d: number) => {
    const next = [...columns]
    const j = i + d
    if (j < 0 || j >= next.length) return
    ;[next[i], next[j]] = [next[j], next[i]]
    onColumns(next)
  }

  const value = (name: string) => {
    if (!subject) {
      const n = available.find((p) => p.name === name)?.count ?? 0
      return <span className="text-[11px] tabular-nums text-(--text-faint)" title={`${n} of ${totalRows} objects have this property`}>{n}/{totalRows}</span>
    }
    const err = subject.errors[name]
    if (err !== undefined)
      return (
        <span className="rounded-full bg-(--status-alarm-bg) px-2 py-px text-[11px]" title={err}>
          unreadable
        </span>
      )
    const v = subject.values[name]
    if (v === undefined || v === '') return <span className="text-(--ink-4)">–</span>
    return (
      <span className="block truncate text-[12.5px] tabular-nums" title={v}>
        {v}
      </span>
    )
  }

  const renderRow = (name: string, index?: number) => {
    const on = ticked.has(name)
    return (
      <div
        key={name}
        className={cn(
          'group/prop grid h-8 grid-cols-[16px_minmax(0,1fr)_minmax(0,0.9fr)] items-center gap-2.5 rounded-[9px] px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_4%,transparent)]',
          on && 'bg-(--surface-checked) hover:bg-(--surface-checked)',
        )}
      >
        <Checkbox checked={on} onCheckedChange={() => toggle(name)} aria-label={on ? `Stop exporting ${name}` : `Export ${name}`} />
        <button className="min-w-0 truncate text-left text-[13px]" title={name} onClick={() => toggle(name)}>
          {name}
        </button>
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
          <span className={cn('min-w-0 text-right', index !== undefined && 'group-hover/prop:hidden')}>{value(name)}</span>
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
    <aside className="flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
      <div key={subject?.key ?? 'all'} className="nc-view-in flex items-start gap-3 px-[18px] pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] text-(--text-faint)">
            {subject ? `${subject.values['Object type']} · ${subject.instance}` : subjectLabel}
          </div>
          <div className="mt-0.5 truncate text-[17px] font-medium tracking-[-0.01em]">{subject ? subject.values['object-name'] || 'Unnamed object' : 'Properties'}</div>
        </div>
        {subject ? (
          <Button aria-label="Show all properties" variant="secondary" size="icon-xs" onClick={onClearSubject}>
            <XIcon />
          </Button>
        ) : null}
      </div>

      <div className="px-[18px] pb-2">
        <div className="mb-2 flex items-start gap-2 rounded-[12px] bg-(--surface-card-muted) px-3 py-2.5 text-[12px] leading-snug text-(--text-muted)">
          <Checkbox checked aria-hidden tabIndex={-1} className="pointer-events-none mt-px" />
          <span>Tick a property to export it as a column.{subject ? '' : ' Pick an object to see its values.'}</span>
        </div>
        <Input ref={searchRef} size="sm" placeholder="Find a property, e.g. address, units, 3019" value={query} onChange={(e) => setQuery(e.target.value)} />
        {subject && subject.status !== 'ok' ? (
          <div className="mt-2 rounded-[12px] bg-(--status-alarm-bg) px-3 py-2 text-[12px] leading-snug">{subject.values['Read status']}</div>
        ) : null}
      </div>

      {available.length === 0 && !subject ? (
        <div className="flex-1">
        <div className="mx-[18px] mt-2 flex gap-2.5 rounded-[12px] border border-dashed border-(--border-default) px-3.5 py-3 text-[12.5px] leading-snug text-(--text-muted)">
          <Search className="mt-px size-4 shrink-0" />
          Click a device in the tree. Once it is read, all its properties are listed here.
        </div>
        </div>
      ) : (
        <ScrollArea scrollFade className="min-h-0 flex-1">
          <div className="flex flex-col px-2.5 pb-3">
            {renderSection('Exporting, in this order', undefined, !exporting.length, exporting.map((name) => renderRow(name, columns.indexOf(name))))}
            {renderSection('Vendor-specific', 'not in an EDE export', !vendor.length, vendor.map((p) => renderRow(p.name)))}
            {renderSection('Standard', undefined, !standard.length, standard.map((p) => renderRow(p.name)))}
            {!exporting.length && !vendor.length && !standard.length ? (
              <p className="m-0 px-2 py-4 text-center text-[12px] text-(--text-muted)">No property matches. Try a shorter search.</p>
            ) : null}
          </div>
        </ScrollArea>
      )}

      {naming ? (
        <form
          className="flex gap-2 border-t border-(--border-subtle) px-[18px] py-2.5"
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--border-subtle) px-[18px] py-3">
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
        {subject ? (
          <span className="flex gap-1.5">
            {onTrend ? (
              <Button size="sm" variant="secondary" onClick={onTrend} disabled={trended}>
                <LineChart />
                {trended ? (trendLabel ? 'In Trends' : 'Trending') : trendLabel ?? 'Trend'}
              </Button>
            ) : null}
            <Button size="sm" variant="secondary" onClick={onReread} disabled={!canRead}>
              Read again
            </Button>
          </span>
        ) : (
          <span className="text-[12px] text-(--text-muted)">{columns.length ? `${columns.length} column${columns.length === 1 ? '' : 's'} ticked` : 'Nothing ticked yet'}</span>
        )}
      </div>
    </aside>
  )
}
