import { useMemo, useRef, useState } from 'react'
import { api, type ObjectRow } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Switch } from '../ui/components/switch'
import { Tabs, TabsCount, TabsList, TabsTab } from '../ui/components/tabs'
import { cn } from '../ui/utils'
import { useToast } from './Toasts'

const { ChevronRight, FolderOpen, FileSpreadsheet, XIcon, Check } = Hugeicons

export type Baseline = { name: string; savedAt: string; host: string; rows: ObjectRow[] }

/** Values that move on their own. Left out by default so the comparison shows configuration changes. */
const LIVE = new Set([
  'present-value', 'status-flags', 'event-state', 'reliability', 'event-time-stamps', 'acked-transitions', 'local-date', 'local-time',
  'system-status', 'active-cov-subscriptions', 'log-buffer', 'record-count', 'total-record-count', 'last-restore-time', 'database-revision',
  'elapsed-active-time', 'change-of-state-count', 'change-of-state-time', 'time-of-active-time-reset', 'time-of-state-count-reset',
  'update-time', 'value-change-time', 'pulse-rate', 'last-notify-record', 'event-message-texts', 'time-of-device-restart', 'utc-time-synchronization-recipients',
  'Read status', 'Device name',
])

/** Read a .bxsite in the browser, without touching what is loaded. */
export async function readSiteFile(file: File): Promise<Baseline> {
  const bytes = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const text =
    bytes[0] === 0x1f && bytes[1] === 0x8b ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text() : await file.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('That file is not a BACon site file (.bxsite).')
  }
  if (data?.format !== 'bacon-site' && data?.format !== 'bacnet-exporter-site') throw new Error('That file is not a BACon site file (.bxsite).')
  return { name: file.name.replace(/\.bxsite$/, ''), savedAt: data.savedAt ?? '', host: data.host ?? '', rows: Object.values(data.objects ?? {}).flat() as ObjectRow[] }
}

type Diff = { prop: string; before: string; after: string }
type Change = { kind: 'added' | 'removed' | 'changed'; row: ObjectRow; diffs: Diff[] }

// files saved before booleans were written as true/false hold 0/1; those are the same value
const BOOL: Record<string, string> = { '0': 'false', '1': 'true', false: 'false', true: 'true' }
const same = (a: string, b: string) => a === b || (BOOL[a] !== undefined && BOOL[a] === BOOL[b])

export function compareRows(now: ObjectRow[], then: ObjectRow[], includeLive: boolean): Change[] {
  const before = new Map(then.map((r) => [r.key, r]))
  const after = new Map(now.map((r) => [r.key, r]))
  const out: Change[] = []
  for (const r of now) {
    const old = before.get(r.key)
    if (!old) {
      out.push({ kind: 'added', row: r, diffs: [] })
      continue
    }
    const diffs: Diff[] = []
    for (const p of new Set([...Object.keys(old.values), ...Object.keys(r.values)])) {
      if (!includeLive && LIVE.has(p)) continue
      const a = old.values[p] ?? ''
      const b = r.values[p] ?? ''
      if (same(a, b)) continue
      diffs.push({ prop: p, before: a, after: b })
    }
    if (diffs.length) out.push({ kind: 'changed', row: r, diffs: diffs.sort((x, y) => x.prop.localeCompare(y.prop)) })
  }
  for (const r of then) if (!after.has(r.key)) out.push({ kind: 'removed', row: r, diffs: [] })
  return out
}

const KIND = {
  added: { label: 'added', chip: 'bg-(--color-ns-green)' },
  removed: { label: 'removed', chip: 'bg-(--color-ns-red)' },
  changed: { label: 'changed', chip: 'bg-(--color-ns-yellow)' },
}

function when(savedAt: string) {
  if (!savedAt) return 'earlier'
  return new Date(savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

export function Changes({
  rows,
  deviceIds,
  typeFilter,
  baseline,
  onBaseline,
  selectedKey,
  onSelect,
}: {
  rows: ObjectRow[]
  deviceIds: number[] | null
  typeFilter: string | null
  baseline: Baseline | null
  onBaseline: (b: Baseline | null) => void
  selectedKey: string | null
  onSelect: (row: ObjectRow) => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [includeLive, setIncludeLive] = useState(false)
  const [kind, setKind] = useState<'all' | Change['kind']>('all')
  const [open, setOpen] = useState<Set<string>>(new Set())

  const then = useMemo(
    () => (baseline ? baseline.rows.filter((r) => (!deviceIds || deviceIds.includes(r.device)) && (!typeFilter || r.values['Object type'] === typeFilter)) : []),
    [baseline, deviceIds, typeFilter],
  )
  const changes = useMemo(() => (baseline ? compareRows(rows, then, includeLive) : []), [baseline, rows, then, includeLive])
  const count = (k: Change['kind']) => changes.filter((c) => c.kind === k).length
  const shown = kind === 'all' ? changes : changes.filter((c) => c.kind === kind)

  const pick = async (file: File) => {
    try {
      const b = await readSiteFile(file)
      onBaseline(b)
      setOpen(new Set())
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  const exportChanges = async () => {
    try {
      const columns = ['Change', 'Device', 'Object type', 'Instance', 'object-name', 'Property', 'Before', 'After']
      const lines = changes.flatMap((c) => {
        const id = [c.kind, String(c.row.device), c.row.values['Object type'], String(c.row.instance), c.row.values['object-name'] ?? '']
        return c.diffs.length ? c.diffs.map((d) => [...id, d.prop, d.before, d.after]) : [[...id, '', '', '']]
      })
      const filename = `bacnet-changes-since-${(baseline?.savedAt ?? '').slice(0, 16).replace(/[:T]/g, '')}.xlsx`
      const blob = await api.exportXlsx(filename, [{ name: 'Changes', columns, rows: lines }])
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast(`Saved the changes to ${filename}`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  const picker = (
    <input
      ref={fileRef}
      type="file"
      accept=".bxsite"
      hidden
      onChange={(e) => {
        const f = e.target.files?.[0]
        if (f) pick(f)
        e.target.value = ''
      }}
    />
  )

  if (!baseline) {
    return (
      <div className="nc-view-in mx-auto flex max-w-[380px] flex-col items-center px-5 py-16 text-center">
        <div className="text-[15px] font-medium">Compare with an earlier read</div>
        <div className="mt-1 text-[13px] leading-normal text-(--text-muted)">Open a saved site to see which objects were added, removed, or changed since then.</div>
        <Button size="sm" className="mt-4" onClick={() => fileRef.current?.click()}>
          <FolderOpen />
          Choose a saved site
        </Button>
        {picker}
      </div>
    )
  }

  return (
    <div className="nc-view-in flex flex-col gap-3 px-[18px] pb-6">
      {picker}
      <div className="flex items-center gap-3 rounded-[14px] bg-(--surface-card-muted) px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-medium">Compared with {baseline.name}</span>
          <span className="block truncate text-[12px] text-(--text-muted)">
            Saved {when(baseline.savedAt)}
            {baseline.host ? ` on ${baseline.host}` : ''}
          </span>
        </span>
        <Button size="sm" variant="white" onClick={exportChanges} disabled={!changes.length}>
          <FileSpreadsheet />
          Export
        </Button>
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()}>
          Choose another
        </Button>
        <Button aria-label="Stop comparing" variant="ghost" size="icon-sm" onClick={() => onBaseline(null)}>
          <XIcon />
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <TabsList>
            <TabsTab value="all">
              All <TabsCount>{changes.length}</TabsCount>
            </TabsTab>
            <TabsTab value="added">
              Added <TabsCount>{count('added')}</TabsCount>
            </TabsTab>
            <TabsTab value="removed">
              Removed <TabsCount>{count('removed')}</TabsCount>
            </TabsTab>
            <TabsTab value="changed">
              Changed <TabsCount>{count('changed')}</TabsCount>
            </TabsTab>
          </TabsList>
        </Tabs>
        <span className="flex-1" />
        <label className="flex items-center gap-2 text-[12.5px] text-(--text-muted)">
          Include live values
          <Switch checked={includeLive} onCheckedChange={setIncludeLive} />
        </label>
      </div>

      {!changes.length ? (
        <div className="flex items-center gap-3 rounded-[14px] border border-(--border-subtle) px-4 py-4">
          <span className="inline-flex size-8 items-center justify-center rounded-full bg-(--color-ns-green)">
            <Check className="size-4" />
          </span>
          <span>
            <span className="block text-[14px] font-medium">Nothing changed</span>
            <span className="block text-[12.5px] text-(--text-muted)">
              Same objects and {includeLive ? 'values' : 'configuration'} as {when(baseline.savedAt)}.
            </span>
          </span>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-(--border-subtle)">
          {shown.map((c) => {
            const canOpen = c.kind === 'changed'
            const isOpen = open.has(c.row.key)
            return (
              <div key={`${c.kind}:${c.row.key}`} className="border-b border-(--border-divider) last:border-b-0">
                <button
                  onClick={() => {
                    if (c.kind !== 'removed') onSelect(c.row)
                    if (canOpen)
                      setOpen((o) => {
                        const n = new Set(o)
                        if (n.has(c.row.key)) n.delete(c.row.key)
                        else n.add(c.row.key)
                        return n
                      })
                  }}
                  data-selected={selectedKey === c.row.key ? 'true' : undefined}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-(--surface-hover) data-[selected=true]:bg-(--surface-hover)"
                >
                  <ChevronRight className={cn('size-4 shrink-0 text-(--text-muted) transition-transform', !canOpen && 'invisible', isOpen && 'rotate-90')} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-[13px] font-medium', c.kind === 'removed' && 'text-(--text-muted) line-through decoration-(--ink-4)')}>
                      {c.row.values['object-name'] || 'Unnamed'}
                    </span>
                    <span className="mt-1 flex items-center gap-1">
                      <span className="rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">{c.row.values['Object type']}</span>
                      <span className="rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">#{c.row.instance}</span>
                    </span>
                  </span>
                  {c.kind === 'changed' ? (
                    <span className="text-[12px] text-(--text-muted)">
                      {c.diffs.length} propert{c.diffs.length === 1 ? 'y' : 'ies'}
                    </span>
                  ) : null}
                  <span className={cn('rounded-full px-2 py-px text-[11px] lowercase', KIND[c.kind].chip)}>{KIND[c.kind].label}</span>
                </button>
                {isOpen ? (
                  <div className="mx-4 mb-3 overflow-hidden rounded-[10px] bg-(--surface-card-muted)">
                    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 px-3 py-1.5 text-[11.5px] text-(--text-muted)">
                      <span>Property</span>
                      <span>Before</span>
                      <span>Now</span>
                    </div>
                    {c.diffs.map((d) => (
                      <div key={d.prop} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-t border-(--border-divider) px-3 py-2 text-[12.5px]">
                        <span className="truncate" title={d.prop}>
                          {d.prop}
                        </span>
                        <span className="truncate text-(--text-muted)" title={d.before}>
                          {d.before || '–'}
                        </span>
                        <span className="truncate font-medium" title={d.after}>
                          {d.after || '–'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
