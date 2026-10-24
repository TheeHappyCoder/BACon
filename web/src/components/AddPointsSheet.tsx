import { useMemo, useState } from 'react'
import type { Device, ObjectRow } from '../api'
import { evaluate, parse } from '../query'
import { Button } from '../ui/components/button'
import { Checkbox } from '../ui/components/checkbox'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Sheet, SheetDescription, SheetFooter, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '../ui/components/sheet'
import { cn } from '../ui/utils'

const { Search } = Hugeicons

const LOOKS_LIKE_QUERY = /(=|<|>|~|\bhas\b|\bcontains\b|\bis\s+(set|missing|unreadable|not)\b)/i
const MAX_SHOWN = 400

/**
 * Pick many points at once: narrow by device, by object type (one tap), or by a query such as
 * units = degrees-celsius, then select everything that matches.
 */
export function AddPointsSheet({
  open,
  onOpenChange,
  rows,
  devices,
  trendedKeys,
  onAdd,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rows: ObjectRow[]
  devices: Device[]
  trendedKeys: Set<string>
  onAdd: (rows: ObjectRow[]) => void
}) {
  const [device, setDevice] = useState<string>('all')
  const [types, setTypes] = useState<Set<string>>(new Set())
  const [text, setText] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  // things with a present value, and trend logs (their history is read from the controller)
  const candidates = useMemo(() => rows.filter((r) => (r.values['present-value'] !== undefined && r.typeId !== 8) || r.typeId === 20 || r.typeId === 27), [rows])
  const inDevice = useMemo(() => (device === 'all' ? candidates : candidates.filter((r) => String(r.device) === device)), [candidates, device])
  const typeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of inDevice) m.set(r.values['Object type'], (m.get(r.values['Object type']) ?? 0) + 1)
    return [...m].sort((a, b) => b[1] - a[1])
  }, [inDevice])
  const props = useMemo(() => [...new Set(inDevice.flatMap((r) => Object.keys(r.values)))], [inDevice])

  const { matches, error } = useMemo(() => {
    let list = types.size ? inDevice.filter((r) => types.has(r.values['Object type'])) : inDevice
    const t = text.trim()
    if (!t) return { matches: list, error: '' }
    if (LOOKS_LIKE_QUERY.test(t)) {
      try {
        const node = parse(t, props)
        if (node) list = list.filter((r) => evaluate(node, r))
        return { matches: list, error: '' }
      } catch (e) {
        return { matches: list, error: e instanceof Error ? e.message : String(e) }
      }
    }
    const q = t.toLowerCase()
    return { matches: list.filter((r) => [r.values['object-name'], r.values.description, r.values['Object type']].some((v) => (v ?? '').toLowerCase().includes(q))), error: '' }
  }, [inDevice, types, text, props])

  const selectable = matches.filter((r) => !trendedKeys.has(r.key))
  const allPicked = selectable.length > 0 && selectable.every((r) => picked.has(r.key))
  const somePicked = selectable.some((r) => picked.has(r.key))
  const chosen = candidates.filter((r) => picked.has(r.key))

  const toggle = (key: string) =>
    setPicked((p) => {
      const n = new Set(p)
      if (n.has(key)) n.delete(key)
      else n.add(key)
      return n
    })
  const toggleAll = () =>
    setPicked((p) => {
      const n = new Set(p)
      for (const r of selectable) {
        if (allPicked) n.delete(r.key)
        else n.add(r.key)
      }
      return n
    })
  const toggleType = (t: string) =>
    setTypes((s) => {
      const n = new Set(s)
      if (n.has(t)) n.delete(t)
      else n.add(t)
      return n
    })

  const deviceItems = [{ value: 'all', label: 'Every device' }, ...devices.filter((d) => d.objectCount).map((d) => ({ value: String(d.instance), label: d.name || `Device ${d.instance}` }))]

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) setPicked(new Set())
      }}
    >
      <SheetPopup side="right" className="max-w-[520px]" initialFocus={(type) => type === 'keyboard'}>
        <SheetHeader className="gap-0.5 border-b border-(--border-subtle) px-5 pt-[18px] pb-3.5 pr-14">
          <SheetTitle>Add points to trend</SheetTitle>
          <SheetDescription className="text-[12px]">Narrow it down, then select everything that matches.</SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-2.5 border-b border-(--border-subtle) px-5 py-3.5">
          <div className="flex gap-2">
            {deviceItems.length > 2 ? (
              <Select value={device} onValueChange={(v) => setDevice(v as string)} items={deviceItems}>
                <SelectTrigger className="w-[170px] min-w-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {deviceItems.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            ) : null}
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-[12px] border border-(--border-default) bg-(--surface-input) px-2.5 shadow-[0_1px_2px_rgba(0,0,0,.05)] focus-within:border-(--ring)">
              <Search className="size-4 shrink-0 text-(--text-faint)" />
              <Input unstyled nativeInput className="h-full flex-1 text-[13px]" placeholder="Name, or a query like units = degrees-celsius" value={text} onChange={(e) => setText(e.target.value)} />
            </label>
          </div>
          {error ? <span className="text-[12px]">{error}</span> : null}
          <div className="flex flex-wrap gap-1.5">
            {typeCounts.map(([t, n]) => (
              <button
                key={t}
                onClick={() => toggleType(t)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors',
                  types.has(t) ? 'bg-(--ink) text-white' : 'bg-(--surface-track) hover:bg-(--paper-3)',
                )}
              >
                {t}
                <span className={cn('tabular-nums', types.has(t) ? 'text-white/70' : 'text-(--text-faint)')}>{n}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center gap-3 border-b border-(--border-subtle) bg-(--surface-card-muted) px-5 py-2.5">
          <Checkbox checked={allPicked} indeterminate={!allPicked && somePicked} onCheckedChange={toggleAll} disabled={!selectable.length} />
          <span className="text-[13px] font-medium">{allPicked ? 'All matching selected' : `Select all ${selectable.length} matching`}</span>
          <span className="ml-auto text-[12px] tabular-nums text-(--text-muted)">{matches.length} shown</span>
        </label>

        <SheetPanel className="p-0">
          <div className="flex flex-col py-1">
            {matches.slice(0, MAX_SHOWN).map((r) => {
              const already = trendedKeys.has(r.key)
              return (
                <label
                  key={r.key}
                  className={cn(
                    'mx-2 flex cursor-pointer items-center gap-3 rounded-[10px] px-3 py-2 transition-colors hover:bg-(--surface-hover)',
                    picked.has(r.key) && 'bg-(--surface-checked) hover:bg-(--surface-checked)',
                    already && 'cursor-default opacity-60',
                  )}
                >
                  <Checkbox checked={already || picked.has(r.key)} disabled={already} onCheckedChange={() => toggle(r.key)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium">{r.values['object-name'] || 'Unnamed'}</span>
                    <span className="mt-0.5 flex items-center gap-1">
                      <span className="rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">{r.values['Object type']}</span>
                      <span className="rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">#{r.instance}</span>
                      {device === 'all' && deviceItems.length > 2 ? (
                        <span className="truncate rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">{r.values['Device name'] || r.device}</span>
                      ) : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[12.5px] tabular-nums">
                    {already ? (
                      <span className="text-(--text-muted)">trending</span>
                    ) : r.typeId === 20 || r.typeId === 27 ? (
                      <span className="text-(--text-muted)">{r.values['record-count'] ? `log · ${Number(r.values['record-count']).toLocaleString()} records` : 'log'}</span>
                    ) : (
                      r.values['present-value']
                    )}
                  </span>
                </label>
              )
            })}
            {matches.length > MAX_SHOWN ? (
              <div className="px-5 py-2 text-[12px] text-(--text-muted)">The first {MAX_SHOWN} are listed. Select all still takes every match.</div>
            ) : null}
            {!matches.length ? (
              <div className="px-5 py-10 text-center text-[13px] text-(--text-muted)">{candidates.length ? 'Nothing matches. Try a shorter search, or clear the type chips.' : 'Read a device in Objects first.'}</div>
            ) : null}
          </div>
        </SheetPanel>

        <SheetFooter className="justify-between px-5 sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!chosen.length}
            onClick={() => {
              onAdd(chosen)
              setPicked(new Set())
              onOpenChange(false)
            }}
          >
            {chosen.length ? `Add ${chosen.length} point${chosen.length === 1 ? '' : 's'}` : 'Add points'}
          </Button>
        </SheetFooter>
      </SheetPopup>
    </Sheet>
  )
}
