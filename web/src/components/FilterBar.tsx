import { forwardRef, useMemo, useState } from 'react'
import type { ObjectRow } from '../api'
import { OP_LABEL, QueryError, UNARY, distinctValues, isNumericProp, parse, toConds, toText, type Cond, type Op } from '../query'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { Popover, PopoverPopup, PopoverTrigger } from '../ui/components/popover'
import { cn } from '../ui/utils'

const { XIcon, BookmarkPlus, MoreHorizontal, Filter, AlertTriangle, Search, LineChart } = Hugeicons

export type Severity = 'critical' | 'high' | 'low'

const NUMERIC_OPS: Op[] = ['=', '!=', '>', '>=', '<', '<=', 'contains']
const TEXT_OPS: Op[] = ['=', '!=', 'contains', 'has']
/** Typed text that is trying to be a query rather than a search. */
const LOOKS_LIKE_QUERY = /(=|<|>|~|\bhas\b|\bcontains\b|\bis\s+(set|missing|unreadable|not)\b)/i

// ---- the builder: property, condition, value ---------------------------------------------------

function Builder({ rows, props, initial, onApply }: { rows: ObjectRow[]; props: { name: string; count: number }[]; initial?: Cond; onApply: (c: Cond) => void }) {
  const [prop, setProp] = useState(initial?.prop ?? '')
  const [picking, setPicking] = useState(!initial)
  const [op, setOp] = useState<Op>(initial?.op ?? '=')
  const [value, setValue] = useState(initial?.value ?? '')
  const [search, setSearch] = useState('')

  const numeric = useMemo(() => (prop ? isNumericProp(rows, prop) : false), [rows, prop])
  const suggestions = useMemo(() => (prop ? distinctValues(rows, prop) : []), [rows, prop])
  const ops = [...(numeric ? NUMERIC_OPS : TEXT_OPS), ...UNARY]
  const q = search.trim().toLowerCase()
  const list = props.filter((p) => !q || p.name.toLowerCase().includes(q)).slice(0, 200)
  const unary = UNARY.includes(op)
  const ready = prop && (unary || value.trim())
  const apply = () => ready && onApply({ prop, op, value: unary ? '' : value.trim() })

  return (
    <div className="flex w-[360px] flex-col">
      <div className="flex flex-col gap-1.5 p-3 pb-2.5">
        <span className="text-[12px] text-(--text-muted)">Property</span>
        {!picking ? (
          <button className="flex h-8 items-center justify-between rounded-[10px] bg-(--surface-card-muted) px-2.5 text-left text-[13px] font-medium" onClick={() => setPicking(true)}>
            <span className="truncate">{prop}</span>
            <span className="shrink-0 text-[12px] font-normal text-(--action-primary)">Change</span>
          </button>
        ) : (
          <>
            <Input autoFocus size="sm" placeholder="Find a property, e.g. present-value, 3019" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-[220px] overflow-y-auto">
              {list.map((p) => (
                <button
                  key={p.name}
                  onClick={() => {
                    setProp(p.name)
                    setPicking(false)
                    setSearch('')
                    setValue('')
                    setOp(isNumericProp(rows, p.name, 0.6) ? '>' : '=')
                  }}
                  className="flex h-8 w-full items-center justify-between gap-2 rounded-[8px] px-2 text-left text-[13px] hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"
                >
                  <span className="truncate">{p.name}</span>
                  <span className="shrink-0 text-[11px] tabular-nums text-(--text-faint)">{p.count}</span>
                </button>
              ))}
              {!list.length ? <div className="px-2 py-3 text-center text-[12px] text-(--text-muted)">No property matches.</div> : null}
            </div>
          </>
        )}
      </div>

      {!picking ? (
        <div className="flex flex-col gap-3 border-t border-(--border-subtle) p-3">
          <div className="flex flex-wrap gap-1">
            {ops.map((o) => (
              <button
                key={o}
                onClick={() => setOp(o)}
                className={cn('h-7 rounded-full px-2.5 text-[12px] transition-colors', op === o ? 'bg-(--ink) text-white' : 'bg-(--surface-track) hover:bg-(--paper-3)')}
              >
                {OP_LABEL[o]}
              </button>
            ))}
          </div>
          {!unary ? (
            <div className="flex flex-col gap-2">
              <Input
                autoFocus
                size="sm"
                placeholder={numeric ? 'A number, e.g. 55' : 'A value, e.g. fault'}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && apply()}
              />
              {suggestions.length ? (
                <div className="flex flex-wrap gap-1">
                  {suggestions.map((s) => (
                    <button
                      key={s.value}
                      onClick={() => setValue(s.value)}
                      className={cn('inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2 text-[11.5px] transition-colors', value === s.value ? 'bg-(--surface-checked)' : 'bg-(--surface-track) hover:bg-(--paper-3)')}
                    >
                      <span className="truncate">{s.value}</span>
                      <span className="tabular-nums text-(--text-faint)">{s.count}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <Button size="sm" className="self-end" onClick={apply} disabled={!ready}>
            {initial ? 'Update' : 'Add filter'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

// ---- save as check -------------------------------------------------------------------------------

function SaveCheckDialog({ open, onOpenChange, query, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; query: string; onSave: (name: string, s: Severity) => void }) {
  const [name, setName] = useState('')
  const [severity, setSeverity] = useState<Severity>('high')
  const SEV: Record<Severity, string> = { critical: 'bg-(--color-ns-red)', high: 'bg-(--color-ns-yellow)', low: 'bg-(--color-ns-cyan-light)' }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">Save as a check</DialogTitle>
          <p className="m-0 mt-0.5 text-[12px] text-(--text-muted)">It runs in Health check on every site you open.</p>
        </DialogHeader>
        <form
          id="save-check"
          className="flex flex-col gap-3 border-y border-(--border-subtle) bg-(--surface-card) px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            onSave(name.trim(), severity)
            setName('')
          }}
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-(--text-muted)">Name</span>
            <Input autoFocus size="lg" placeholder="e.g. Supply air too warm" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="text-[12px] text-(--text-muted)">Severity</span>
            <div className="flex gap-1.5">
              {(['critical', 'high', 'low'] as Severity[]).map((s) => (
                <button
                  type="button"
                  key={s}
                  onClick={() => setSeverity(s)}
                  className={cn('h-8 rounded-full px-3.5 text-[13px] lowercase transition-colors', severity === s ? SEV[s] : 'bg-(--surface-track) text-(--text-muted) hover:text-(--text-strong)')}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-[12px] bg-(--surface-card-muted) px-3 py-2.5 text-[12.5px] break-words text-(--text-muted)">{query}</div>
        </form>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="save-check" disabled={!name.trim()}>
            Save check
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

// ---- the filter field ------------------------------------------------------------------------------

/**
 * One field for finding objects: filters sit inside it as chips, plain words search, and a typed query like
 * present-value > 55 becomes a chip on Enter. The count of matches sits at its right edge.
 */
export const FilterField = forwardRef<
  HTMLInputElement,
  {
    rows: ObjectRow[]
    props: { name: string; count: number }[]
    query: string
    onQuery: (q: string) => void
    search: string
    onSearch: (s: string) => void
    matchCount: number
    totalCount: number
    onSaveCheck: (name: string, severity: Severity, query: string) => void
    onTrend: () => void
    /** sits as the header row of a table: no border of its own */
    embedded?: boolean
  }
>(function FilterField({ rows, props, query, onQuery, search, onSearch, matchCount, totalCount, onSaveCheck, onTrend, embedded }, ref) {
  const names = useMemo(() => props.map((p) => p.name), [props])
  const node = useMemo(() => {
    try {
      return parse(query, names)
    } catch {
      return null
    }
  }, [query, names])
  const flat = toConds(node)
  const conds = flat?.conds ?? []
  const join = flat?.join ?? 'and'

  const [draft, setDraft] = useState(search)
  const [hint, setHint] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const active = !!query.trim() || !!search.trim()

  const setConds = (next: Cond[], j: 'and' | 'or' = join) => onQuery(toText(next, j))

  const onDraft = (text: string) => {
    setDraft(text)
    if (!text.trim()) {
      setHint(null)
      onSearch('')
      return
    }
    if (LOOKS_LIKE_QUERY.test(text)) {
      onSearch('') // a half-typed query is not a search
      try {
        parse(text, names)
        setHint({ kind: 'ok', text: 'Press Enter to add this filter' })
      } catch (e) {
        setHint({ kind: 'error', text: e instanceof QueryError ? e.message : String(e) })
      }
    } else {
      setHint(null)
      onSearch(text)
    }
  }

  const commit = () => {
    if (!draft.trim() || !LOOKS_LIKE_QUERY.test(draft)) return
    try {
      const added = parse(draft, names)
      const addedFlat = toConds(added)
      if (addedFlat && addedFlat.join === 'and' && (join === 'and' || conds.length < 2)) setConds([...conds, ...addedFlat.conds], conds.length ? join : addedFlat.join)
      else onQuery(query.trim() ? `(${query}) and (${draft.trim()})` : draft.trim())
      setDraft('')
      setHint(null)
    } catch (e) {
      setHint({ kind: 'error', text: e instanceof QueryError ? e.message : String(e) })
    }
  }

  const builder = (index: number | 'new') => (
    <Builder
      rows={rows}
      props={props}
      initial={index === 'new' ? undefined : conds[index]}
      onApply={(c) => {
        setConds(index === 'new' ? [...conds, c] : conds.map((x, i) => (i === index ? c : x)))
        setEditing(null)
      }}
    />
  )

  return (
    <div className={cn('flex flex-col', embedded ? 'shrink-0' : 'gap-1.5')}>
      <div
        className={cn(
          'flex min-h-10 items-start gap-2 py-1 transition-colors',
          embedded
            ? 'pr-2 pl-4'
            : 'rounded-[12px] border border-(--border-default) bg-(--surface-input) pr-1 pl-3 shadow-[0_1px_2px_rgba(0,0,0,.05)] focus-within:border-(--ring) hover:border-(--border-strong)',
        )}
      >
        <span className="flex h-8 shrink-0 items-center">
          {conds.length || query ? <Filter className="size-4 text-(--text-faint)" /> : <Search className="size-4 text-(--text-faint)" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">

        {flat
          ? conds.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 ? (
                  <button
                    className="rounded-md px-1 text-[12px] text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)"
                    title="Match all or any of the filters"
                    onClick={() => setConds(conds, join === 'and' ? 'or' : 'and')}
                  >
                    {join}
                  </button>
                ) : null}
                <Popover open={editing === i} onOpenChange={(o) => setEditing(o ? i : null)}>
                  <PopoverTrigger
                    render={
                      <span className="inline-flex h-7 max-w-[320px] items-center rounded-[8px] bg-(--surface-track) pr-0.5 pl-2.5 text-[12.5px] transition-colors hover:bg-(--paper-3) data-popup-open:bg-(--paper-3)" />
                    }
                  >
                    <button className="flex min-w-0 items-center gap-1.5" onClick={() => setEditing(i)}>
                      <span className="truncate font-medium">{c.prop}</span>
                      <span className="shrink-0 text-(--text-muted)">{OP_LABEL[c.op]}</span>
                      {c.value ? <span className="truncate">{c.value}</span> : null}
                    </button>
                    <button
                      aria-label={`Remove ${c.prop} filter`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setConds(conds.filter((_, j) => j !== i))
                      }}
                      className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-(--text-muted) hover:bg-(--surface-card) hover:text-(--text-strong)"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </PopoverTrigger>
                  <PopoverPopup>{editing === i ? builder(i) : null}</PopoverPopup>
                </Popover>
              </span>
            ))
          : query ? (
              <button
                className="inline-flex h-7 max-w-[420px] items-center rounded-[8px] bg-(--surface-track) px-2.5 text-[12.5px] hover:bg-(--paper-3)"
                title="Edit this query"
                onClick={() => {
                  onDraft(query)
                  onQuery('')
                }}
              >
                <span className="truncate">{query}</span>
              </button>
            ) : null}

        <input
          ref={ref}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              onDraft('')
              ;(e.target as HTMLInputElement).blur()
            }
            if (e.key === 'Backspace' && !draft && conds.length) setConds(conds.slice(0, -1))
          }}
          placeholder={conds.length || query ? 'Add a filter or search…' : 'Search, or type a filter like present-value > 55'}
          className="h-8 min-w-[160px] flex-1 bg-transparent text-[13px] outline-none placeholder:text-[color-mix(in_srgb,var(--text-muted)_72%,transparent)]"
        />
        </div>

        <span className="flex h-8 shrink-0 items-center gap-0.5">
          <span className="mr-1.5 text-[12px] tabular-nums text-(--text-muted)">
            {active ? `${matchCount} of ${totalCount}` : `${totalCount} objects`}
          </span>
          <Popover open={editing === 'new'} onOpenChange={(o) => setEditing(o ? 'new' : null)}>
            <PopoverTrigger render={<Button aria-label="Add a filter" title="Add a filter" variant="secondary" size="xs" className="h-7" />}>
              <Filter />
              Filter
            </PopoverTrigger>
            <PopoverPopup align="end">{editing === 'new' ? builder('new') : null}</PopoverPopup>
          </Popover>
          <Menu>
            <MenuTrigger render={<Button aria-label="More filter options" variant="ghost" size="icon-sm" />}>
              <MoreHorizontal />
            </MenuTrigger>
            <MenuPopup align="end" className="w-60">
              <MenuItem onClick={() => setConds([...conds, { prop: 'Read status', op: '!=', value: 'ok' }])}>
                <AlertTriangle />
                Show read problems
              </MenuItem>
              <MenuItem onClick={onTrend} disabled={!matchCount}>
                <LineChart />
                Trend {active ? `these ${matchCount}` : `all ${matchCount}`} objects
              </MenuItem>
              <MenuItem onClick={() => setSaving(true)} disabled={!query.trim()}>
                <BookmarkPlus />
                Save as a check
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                onClick={() => {
                  onQuery('')
                  onDraft('')
                }}
                disabled={!active}
              >
                <XIcon />
                Clear
              </MenuItem>
            </MenuPopup>
          </Menu>
        </span>
      </div>
      {hint ? <span className={cn('text-[12px]', embedded ? 'px-4 pb-2' : 'px-1', hint.kind === 'error' ? 'text-(--text-strong)' : 'text-(--text-muted)')}>{hint.text}</span> : null}
      <SaveCheckDialog
        open={saving}
        onOpenChange={setSaving}
        query={query}
        onSave={(name, s) => {
          onSaveCheck(name, s, query)
          setSaving(false)
        }}
      />
    </div>
  )
})
