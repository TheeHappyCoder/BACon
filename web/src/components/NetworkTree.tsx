import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { Device, Job, ObjectRow, Status } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { ScrollArea } from '../ui/components/scroll-area'
import { Skeleton } from '../ui/components/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'
import { SPIN } from './spin'

const { ChevronRight, Network, Cpu, Download, FolderOpen, MoreHorizontal, ReloadIcon, Plus, Trash2, CircleStop, Activity, ToggleLeft, List, Box, Calendar, Bell, File, LineChart, Layers, Settings2, Workflow, Type, Hash } = Hugeicons

export type Selection =
  | { kind: 'network' }
  | { kind: 'device'; device: number }
  | { kind: 'type'; device: number; type: string }
  /** type: the object was picked from a type-filtered table, so the scope stays that type */
  | { kind: 'object'; device: number; key: string; type?: string }

function typeIcon(type: string) {
  if (type.startsWith('analog')) return <Activity />
  if (type.startsWith('binary')) return <ToggleLeft />
  if (type.startsWith('multi-state')) return <List />
  if (type.includes('schedule') || type.includes('calendar')) return <Calendar />
  if (type.includes('notification') || type.includes('event')) return <Bell />
  if (type === 'file') return <File />
  if (type.includes('trend') || type.includes('log')) return <LineChart />
  if (type.includes('loop') || type === 'program') return <Workflow />
  if (type.includes('characterstring') || type.includes('octetstring')) return <Type />
  if (type.includes('accumulator') || type.includes('integer')) return <Hash />
  if (type.includes('view') || type.startsWith('type-')) return <Layers />
  if (type === 'device') return <Settings2 />
  return <Box />
}

const PAD = 4
const INDENT = 18

function Count({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-(--surface-track) px-1.5 text-[11.5px] tabular-nums text-(--text-strong)', className)}>
      {children}
    </span>
  )
}

function Row({
  depth,
  icon,
  label,
  title,
  active,
  expandable,
  expanded,
  onClick,
  onToggle,
  trailing,
  menu,
  children,
  strong,
  sub,
}: {
  depth: number
  icon: ReactNode
  label: ReactNode
  /** a second, quieter line under the label; the row grows to 48px and the rest lines up with the first line */
  sub?: ReactNode
  title?: string
  active?: boolean
  expandable?: boolean
  expanded?: boolean
  onClick: () => void
  onToggle?: () => void
  trailing?: ReactNode
  menu?: ReactNode
  children?: ReactNode
  strong?: boolean
}) {
  return (
    <div className="group/row relative" data-active={active ? 'true' : undefined}>
      <div
        role="treeitem"
        aria-selected={active}
        aria-expanded={expandable ? expanded : undefined}
        tabIndex={0}
        title={title}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
          if (expandable && e.key === 'ArrowRight' && !expanded) onToggle?.()
          if (expandable && e.key === 'ArrowLeft' && expanded) onToggle?.()
        }}
        className={cn(
          'relative flex cursor-pointer gap-2 rounded-[9px] pr-2 text-[14px] text-(--text-strong) outline-none transition-colors duration-150 select-none hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] hover:text-(--text-strong) focus-visible:ring-2 focus-visible:ring-ring/50',
          sub ? 'h-[48px] items-start py-1.5' : 'h-[34px] items-center',
          strong && 'font-medium',
          active && 'bg-(--paper-3) text-(--text-strong) hover:bg-(--paper-3)',
        )}
        style={{ paddingLeft: PAD + depth * INDENT }}
      >
        <span
          className={cn('inline-flex size-4 shrink-0 items-center justify-center rounded text-(--text-muted) hover:text-(--text-strong)', sub && 'mt-0.5', !expandable && 'invisible')}
          onClick={(e) => {
            e.stopPropagation()
            onToggle?.()
          }}
        >
          <ChevronRight strokeWidth={2} className={cn('size-4 transition-transform duration-150', expanded && 'rotate-90')} />
        </span>
        {icon ? <span className={cn('flex shrink-0 text-(--text-muted) [&_svg]:size-4 [&_svg]:[stroke-width:1.7]', sub && 'h-5 items-center', active && 'text-(--text-strong)')}>{icon}</span> : null}
        {sub ? (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate leading-5">{label}</span>
            <span className="truncate text-[11.5px] leading-4 font-normal text-(--text-muted)">{sub}</span>
          </span>
        ) : (
          <span className="min-w-0 flex-1 truncate">{label}</span>
        )}
        <span className={cn('flex shrink-0 items-center gap-1.5', sub && 'h-5', menu && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0')}>{trailing}</span>
      </div>
      {menu ? (
        <div className={cn('absolute right-1 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-data-popup-open:opacity-100', sub ? 'top-1' : 'top-1/2 -translate-y-1/2')}>
          {menu}
        </div>
      ) : null}
      {children}
    </div>
  )
}

function RowMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label={label} variant="ghost" size="icon-xs" className="size-6" />}>
        <MoreHorizontal />
      </MenuTrigger>
      <MenuPopup align="start" side="right" sideOffset={6} className="w-56">
        {children}
      </MenuPopup>
    </Menu>
  )
}

export function NetworkTree({
  status,
  devices,
  jobs,
  rows,
  selection,
  onSelect,
  expanded,
  onToggle,
  searching,
  onConnect,
  onSearch,
  onAddByIp,
  onRead,
  onReadAll,
  onCancel,
  onRemove,
  onSaveSite,
  onOpenSite,
  booting,
  matchCounts,
  deviceTriage,
}: {
  booting?: boolean
  /** while a query, search or triage chip is active: how many of each device's objects match, by device instance */
  matchCounts?: Record<number, number> | null
  /** objects in fault and in alarm, by device instance */
  deviceTriage?: Record<number, { fault: number; alarm: number }>
  onSaveSite: () => void
  onOpenSite: (file: File) => void
  status: Status
  devices: Device[]
  jobs: Job[]
  rows: Record<number, ObjectRow[]>
  selection: Selection
  onSelect: (s: Selection) => void
  expanded: Set<string>
  onToggle: (id: string) => void
  searching: boolean
  onConnect: () => void
  onSearch: () => void
  onAddByIp: (ip: string) => Promise<boolean>
  onRead: (device: number, retryFailed?: boolean) => void
  onReadAll: () => void
  onCancel: (jobId: string) => void
  onRemove: (device: number) => void
}) {
  const [adding, setAdding] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [ip, setIp] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const groups = useMemo(() => {
    const out: Record<number, [string, ObjectRow[]][]> = {}
    for (const d of devices) {
      const byType = new Map<string, ObjectRow[]>()
      for (const r of rows[d.instance] ?? []) {
        const t = r.values['Object type']
        byType.set(t, [...(byType.get(t) ?? []), r])
      }
      out[d.instance] = [...byType]
        .map(([t, list]) => [t, list.sort((a, b) => a.instance - b.instance)] as [string, ObjectRow[]])
        .sort((a, b) => a[0].localeCompare(b[0]))
    }
    return out
  }, [devices, rows])

  const latestJob = (inst: number) => [...jobs].reverse().find((j) => j.device === inst)
  const netId = 'net'
  const netOpen = expanded.has(netId)
  const is = (s: Selection) => {
    if (s.kind !== selection.kind) return false
    if (s.kind === 'network' || selection.kind === 'network') return true
    if (s.device !== selection.device) return false
    if (s.kind === 'type' && selection.kind === 'type') return s.type === selection.type
    if (s.kind === 'object' && selection.kind === 'object') return s.key === selection.key
    return true
  }

  const submitIp = async () => {
    if (!ip.trim()) return
    setAddBusy(true)
    const ok = await onAddByIp(ip.trim())
    setAddBusy(false)
    if (ok) {
      setIp('')
      setAdding(false)
    }
  }

  return (
    <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
      <div className="flex items-end justify-between gap-2 px-4 pt-[18px] pb-2.5">
        <div className="min-w-0">
          <div className="text-[11px] text-(--text-faint)">BACon</div>
          {booting ? (
            <Skeleton className="mt-1 h-[18px] w-28 rounded-full" />
          ) : (
            <div className="truncate text-[16px] font-medium tracking-[-0.01em]">{status.host || 'This PC'}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Tooltip>
            <TooltipTrigger render={<Button aria-label="Open a saved site" variant="ghost" size="icon-sm" onClick={() => fileRef.current?.click()} />}>
              <FolderOpen />
            </TooltipTrigger>
            <TooltipPopup>Open a saved site</TooltipPopup>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<Button aria-label="Save this site to a file" variant="ghost" size="icon-sm" disabled={!devices.some((d) => d.objectCount)} onClick={onSaveSite} />}>
              <Download />
            </TooltipTrigger>
            <TooltipPopup>Save this site to a file</TooltipPopup>
          </Tooltip>
          <input
            ref={fileRef}
            type="file"
            accept=".bxsite"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onOpenSite(file)
              e.target.value = ''
            }}
          />
        </div>
      </div>

      {booting ? (
        <div className="flex flex-col gap-2 px-4 pt-1" aria-label="Loading">
          {[150, 120, 170, 110].map((w, i) => (
            <span key={i} className="flex h-[34px] items-center gap-2" style={{ paddingLeft: i ? 18 : 0 }}>
              <Skeleton className="size-4 rounded-[5px]" />
              <Skeleton className="h-3.5 rounded-full" style={{ width: w }} />
            </span>
          ))}
        </div>
      ) : !status.connected ? (
        <div className="mx-3 mb-2 rounded-[12px] border border-dashed border-(--border-default) px-3 py-4 text-center">
          <div className="text-[13px] font-medium">Not connected</div>
          <div className="mt-1 text-[12px] leading-snug text-(--text-muted)">Pick your network adapter, then devices show up here.</div>
          <Button size="xs" className="mt-3" onClick={onConnect}>
            Connect
          </Button>
        </div>
      ) : null}

      <ScrollArea scrollFade className="min-h-0 flex-1">
        <div role="tree" className="flex flex-col gap-px px-2 pb-3">
          {!booting && (status.connected || devices.length) ? (
            <Row
              depth={0}
              icon={<Network />}
              label={
                <span className="text-[13px] font-medium">
                  {status.connected ? `${status.settings?.ip}:${status.settings?.port}` : 'Saved site, offline'}
                </span>
              }
              title="BACnet/IP network"
              active={is({ kind: 'network' })}
              expandable
              expanded={netOpen}
              onToggle={() => onToggle(netId)}
              onClick={() => {
                onSelect({ kind: 'network' })
                if (!netOpen) onToggle(netId)
              }}
              trailing={
                searching ? (
                  <span className="flex items-center gap-1.5 text-[12px] text-(--text-muted)">
                    <ReloadIcon className={`size-3 ${SPIN}`} />
                    searching…
                  </span>
                ) : devices.length ? (
                  <Count>{devices.length}</Count>
                ) : null
              }
              menu={
                <RowMenu label="Network actions">
                  <MenuItem onClick={onSearch} disabled={searching || !status.connected}>
                    <ReloadIcon />
                    Search for devices again
                  </MenuItem>
                  <MenuItem onClick={() => setAdding(true)} disabled={!status.connected}>
                    <Plus />
                    Add a device by IP
                  </MenuItem>
                  <MenuItem onClick={onReadAll} disabled={!devices.length || !status.connected}>
                    <Cpu />
                    Read every device
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={onConnect}>
                    <Settings2 />
                    Network settings
                  </MenuItem>
                </RowMenu>
              }
            >
              {searching ? (
                <span className="pointer-events-none absolute inset-x-2 bottom-[2px] h-[2px] overflow-hidden rounded-full bg-(--surface-track)">
                  <span className="nc-scanbar absolute inset-y-0 w-[30%] rounded-full bg-(--ink)" />
                </span>
              ) : null}
            </Row>
          ) : null}

          {(status.connected || devices.length) && netOpen
            ? devices.map((d) => {
                const devId = `dev:${d.instance}`
                const open = expanded.has(devId)
                const job = latestJob(d.instance)
                const reading = job?.state === 'running'
                const problems = d.failedCount + d.partialCount
                const flagged = deviceTriage?.[d.instance]
                const matched = matchCounts && d.objectCount ? matchCounts[d.instance] ?? 0 : null
                return (
                  <div key={d.instance} className="flex flex-col gap-px">
                    <Row
                      depth={1}
                      strong
                      icon={<Cpu />}
                      label={d.name || `Device ${d.instance}`}
                      sub={
                        <>
                          {[d.model || d.vendorName, d.objectCount ? `${d.objectCount} objects` : 'not read'].filter(Boolean).join(' · ')}
                          {flagged?.fault ? (
                            <span className="text-(--status-alarm-strong)"> · {flagged.fault} in fault</span>
                          ) : flagged?.alarm ? (
                            <span className="text-(--status-alarm-strong)"> · {flagged.alarm} in alarm</span>
                          ) : null}
                        </>
                      }
                      title={`#${d.instance} · ${d.address}${d.vendorName ? ` · ${d.vendorName}` : ''}${d.savedAt ? ` · from a file saved ${d.savedAt.replace('T', ' ')}` : ''}`}
                      active={is({ kind: 'device', device: d.instance })}
                      expandable={(rows[d.instance] ?? []).length > 0}
                      expanded={open}
                      onToggle={() => onToggle(devId)}
                      onClick={() => onSelect({ kind: 'device', device: d.instance })}
                      trailing={
                        reading ? (
                          <span className="flex items-center gap-1.5 text-[12px] tabular-nums text-(--text-strong)">
                            <ReloadIcon className={`size-3 text-(--text-muted) ${SPIN}`} />
                            {job.total ? `${Math.round((100 * job.done) / job.total)}%` : '…'}
                          </span>
                        ) : (
                          <>
                            {problems > 0 ? <span className="size-1.5 rounded-full bg-(--status-alarm-strong)" aria-label={`${problems} objects with problems`} /> : null}
                            {matched !== null ? (
                              <Count className={matched ? 'bg-(--ink) text-(--surface-card)' : 'text-(--text-muted)'} title={`${matched} of ${d.objectCount} match`}>
                                {matched}
                              </Count>
                            ) : d.objectCount ? (
                              <Count>{d.objectCount}</Count>
                            ) : (
                              <span className="text-[12px] text-(--text-muted)">not read</span>
                            )}
                          </>
                        )
                      }
                      menu={
                        <RowMenu label={`Actions for ${d.name || d.instance}`}>
                          {reading && job ? (
                            <MenuItem onClick={() => onCancel(job.id)}>
                              <CircleStop />
                              Stop reading
                            </MenuItem>
                          ) : (
                            <>
                              <MenuItem onClick={() => onRead(d.instance)}>
                                <ReloadIcon />
                                {d.objectCount ? 'Read again' : 'Read all objects'}
                              </MenuItem>
                              {problems > 0 ? (
                                <MenuItem onClick={() => onRead(d.instance, true)}>
                                  <ReloadIcon />
                                  Retry {problems} with problems
                                </MenuItem>
                              ) : null}
                            </>
                          )}
                          <MenuSeparator />
                          <MenuItem variant="destructive" onClick={() => onRemove(d.instance)}>
                            <Trash2 />
                            Remove from list
                          </MenuItem>
                        </RowMenu>
                      }
                    >
                      {reading ? (
                        <span className="pointer-events-none absolute right-2 bottom-[2px] h-[2px] overflow-hidden rounded-full bg-(--surface-track)" style={{ left: PAD + INDENT + 40 }}>
                          <span className="block h-full rounded-full bg-(--ink) transition-[width] duration-300" style={{ width: `${job.total ? Math.max(3, (100 * job.done) / job.total) : 3}%` }} />
                        </span>
                      ) : null}
                    </Row>

                    {open
                      ? (groups[d.instance] ?? []).map(([type, list]) => {
                          const typeId = `type:${d.instance}:${type}`
                          const typeOpen = expanded.has(typeId)
                          const bad = list.some((r) => r.status !== 'ok')
                          return (
                            <div key={type} className="flex flex-col gap-px">
                              <Row
                                depth={2}
                                icon={typeIcon(type)}
                                label={type}
                                active={is({ kind: 'type', device: d.instance, type })}
                                expandable
                                expanded={typeOpen}
                                onToggle={() => onToggle(typeId)}
                                onClick={() => onSelect({ kind: 'type', device: d.instance, type })}
                                trailing={
                                  <>
                                    {bad ? <span className="size-1.5 rounded-full bg-(--status-alarm-strong)" /> : null}
                                    <Count>{list.length}</Count>
                                  </>
                                }
                              />
                              {typeOpen
                                ? list.map((r) => (
                                    <Row
                                      key={r.key}
                                      depth={3}
                                      icon={null}
                                      label={r.values['object-name'] || `${type} ${r.instance}`}
                                      title={`${type} · ${r.instance}`}
                                      active={is({ kind: 'object', device: d.instance, key: r.key })}
                                      onClick={() => onSelect({ kind: 'object', device: d.instance, key: r.key })}
                                      trailing={r.status !== 'ok' ? <span className="size-1.5 rounded-full bg-(--status-alarm-strong)" /> : null}
                                    />
                                  ))
                                : null}
                            </div>
                          )
                        })
                      : null}
                  </div>
                )
              })
            : null}

          {status.connected && netOpen && !devices.length && !searching ? (
            <div className="mx-1 mt-1 rounded-[12px] border border-dashed border-(--border-default) px-3 py-3 text-center text-[12px] leading-snug text-(--text-muted)">
              No devices answered.
              <div className="mt-2 flex justify-center gap-1.5">
                <Button size="xs" variant="secondary" onClick={onSearch}>
                  Search again
                </Button>
                <Button size="xs" variant="secondary" onClick={() => setAdding(true)}>
                  Add by IP
                </Button>
              </div>
            </div>
          ) : null}

          {adding ? (
            <form
              className="nc-view-in mx-1 mt-2 flex flex-col gap-2 rounded-[12px] border border-(--border-subtle) bg-(--surface-card) p-2.5"
              onSubmit={(e) => {
                e.preventDefault()
                submitIp()
              }}
            >
              <span className="text-[12px] text-(--text-muted)">Add a device by IP address</span>
              <Input autoFocus size="sm"  placeholder="192.168.1.67" value={ip} onChange={(e) => setIp(e.target.value)} />
              <div className="flex justify-end gap-1.5">
                <Button type="button" size="xs" variant="ghost" onClick={() => setAdding(false)}>
                  Cancel
                </Button>
                <Button type="submit" size="xs" disabled={!ip.trim()} loading={addBusy}>
                  Add
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  )
}
