import { useState, type ReactNode } from 'react'
import type { Device, Job, Status } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { ScrollArea } from '../ui/components/scroll-area'
import { Skeleton } from '../ui/components/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { cn } from '../ui/utils'
import { SPIN } from './spin'

const { Cpu, MoreHorizontal, ReloadIcon, Plus, Trash2, CircleStop, Settings2, Layers } = Hugeicons

export type Selection =
  | { kind: 'network' }
  | { kind: 'device'; device: number }
  | { kind: 'type'; device: number; type: string }
  /** type: the object was picked from a type-filtered table, so the scope stays that type */
  | { kind: 'object'; device: number; key: string; type?: string }

function Count({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11.5px] tabular-nums text-(--text-muted)', className)}>
      {children}
    </span>
  )
}

/** One line in the list: a device, or every device. The menu replaces the count on hover. */
function Item({
  icon,
  label,
  sub,
  title,
  active,
  onClick,
  trailing,
  menu,
  children,
}: {
  icon: ReactNode
  label: ReactNode
  sub?: ReactNode
  title?: string
  active?: boolean
  onClick: () => void
  trailing?: ReactNode
  menu?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="group/row relative">
      <div
        role="treeitem"
        aria-selected={active}
        tabIndex={0}
        title={title}
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onClick()
          }
        }}
        className={cn(
          'relative flex cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 outline-none transition-colors duration-150 select-none hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] focus-visible:ring-2 focus-visible:ring-ring/50',
          sub ? 'h-[50px]' : 'h-9',
          active && 'bg-(--surface-card) shadow-[0_0_0_1px_var(--border-subtle),0_2px_6px_-2px_rgba(0,0,0,.08)] hover:bg-(--surface-card)',
        )}
      >
        <span className={cn('flex size-7 shrink-0 items-center justify-center rounded-[8px] text-(--text-muted) [&_svg]:size-[15px]', active ? 'bg-(--ink) text-(--color-ns-green)' : 'bg-(--surface-card) shadow-[0_0_0_1px_var(--border-subtle)]')}>{icon}</span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[13.5px] leading-5 font-medium tracking-[-0.005em]">{label}</span>
          {sub ? <span className="truncate text-[11.5px] leading-4 text-(--text-muted)">{sub}</span> : null}
        </span>
        <span className={cn('flex shrink-0 items-center gap-1.5', menu && 'group-hover/row:opacity-0 group-focus-within/row:opacity-0')}>{trailing}</span>
      </div>
      {menu ? (
        <div className="absolute top-1/2 right-1.5 -translate-y-1/2 opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-data-popup-open:opacity-100">{menu}</div>
      ) : null}
      {children}
    </div>
  )
}

function ItemMenu({ label, children }: { label: string; children: ReactNode }) {
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

/**
 * The left pane: the devices on the network, and every device at once on top. Object types are chips above the
 * table and objects are its rows, so the list stays one level deep.
 */
export function NetworkTree({
  status,
  devices,
  jobs,
  selection,
  onSelect,
  searching,
  onConnect,
  onSearch,
  onAddByIp,
  onRead,
  onReadAll,
  onCancel,
  onRemove,
  booting,
  matchCounts,
  deviceTriage,
  totalObjects,
}: {
  booting?: boolean
  /** while a query, search or triage chip is active: how many of each device's objects match, by device instance */
  matchCounts?: Record<number, number> | null
  /** objects in fault and in alarm, by device instance */
  deviceTriage?: Record<number, { fault: number; alarm: number }>
  totalObjects: number
  status: Status
  devices: Device[]
  jobs: Job[]
  selection: Selection
  onSelect: (s: Selection) => void
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
  const [ip, setIp] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const latestJob = (inst: number) => [...jobs].reverse().find((j) => j.device === inst)
  const scopeDevice = selection.kind === 'network' ? null : selection.device
  const totalMatched = matchCounts ? Object.values(matchCounts).reduce((a, b) => a + b, 0) : null

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
    <aside className="flex w-full min-w-0 flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1 pr-2 pl-4">
        <span className="flex-1 text-[12px] font-medium tracking-[0.01em] text-(--text-muted)">
          Devices{devices.length ? <span className="ml-1.5 font-normal tabular-nums text-(--text-faint)">{devices.length}</span> : null}
        </span>
        <Tooltip>
          <TooltipTrigger render={<Button aria-label="Search for devices again" variant="ghost" size="icon-xs" disabled={searching || !status.connected} onClick={onSearch} />}>
            <ReloadIcon className={searching ? SPIN : undefined} />
          </TooltipTrigger>
          <TooltipPopup>Search for devices again</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button aria-label="Add a device by IP" variant="ghost" size="icon-xs" disabled={!status.connected} onClick={() => setAdding(true)} />}>
            <Plus />
          </TooltipTrigger>
          <TooltipPopup>Add a device by IP</TooltipPopup>
        </Tooltip>
        <Menu>
          <MenuTrigger render={<Button aria-label="Network actions" variant="ghost" size="icon-xs" />}>
            <MoreHorizontal />
          </MenuTrigger>
          <MenuPopup align="end" className="w-56">
            <MenuItem onClick={onReadAll} disabled={!devices.length || !status.connected}>
              <Cpu />
              Read every device
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={onConnect}>
              <Settings2 />
              Network settings
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {searching ? (
        <span className="pointer-events-none relative mx-4 -mt-1 mb-1 block h-[2px] shrink-0 overflow-hidden rounded-full bg-(--surface-track)">
          <span className="nc-scanbar absolute inset-y-0 w-[30%] rounded-full bg-(--ink)" />
        </span>
      ) : null}

      {booting ? (
        <div className="flex flex-col gap-2 px-3 pt-1" aria-label="Loading">
          {[150, 120, 170, 110].map((w, i) => (
            <span key={i} className="flex h-[50px] items-center gap-2.5 px-2.5">
              <Skeleton className="size-7 rounded-[8px]" />
              <Skeleton className="h-3.5 rounded-full" style={{ width: w }} />
            </span>
          ))}
        </div>
      ) : !status.connected && !devices.length ? (
        <div className="mx-3 mt-1 rounded-[12px] border border-dashed border-(--border-default) px-3 py-4 text-center">
          <div className="text-[13px] font-medium">Not connected</div>
          <div className="mt-1 text-[12px] leading-snug text-(--text-muted)">Pick your network adapter, then devices show up here.</div>
          <Button size="xs" className="mt-3" onClick={onConnect}>
            Connect
          </Button>
        </div>
      ) : null}

      <ScrollArea scrollFade className="min-h-0 flex-1">
        <div role="tree" className="flex flex-col gap-0.5 px-2 pb-3">
          {!booting && (status.connected || devices.length) ? (
            <Item
              icon={<Layers />}
              label="All devices"
              sub={status.connected ? `${status.settings?.ip}:${status.settings?.port}` : 'Saved site, offline'}
              title="Every object on every device"
              active={selection.kind === 'network'}
              onClick={() => onSelect({ kind: 'network' })}
              trailing={
                totalMatched !== null ? (
                  <Count className="bg-(--ink) text-(--surface-card)">{totalMatched}</Count>
                ) : totalObjects ? (
                  <Count>{totalObjects}</Count>
                ) : null
              }
            />
          ) : null}

          {devices.length ? <div className="mx-2.5 my-1.5 h-px bg-(--border-subtle)" /> : null}

          {devices.map((d) => {
            const job = latestJob(d.instance)
            const reading = job?.state === 'running'
            const problems = d.failedCount + d.partialCount
            const flagged = deviceTriage?.[d.instance]
            const matched = matchCounts && d.objectCount ? matchCounts[d.instance] ?? 0 : null
            return (
              <Item
                key={d.instance}
                icon={<Cpu />}
                label={d.name || `Device ${d.instance}`}
                sub={
                  <>
                    {[d.model || d.vendorName || `#${d.instance}`, d.objectCount ? `${d.objectCount} objects` : 'not read'].filter(Boolean).join(' · ')}
                    {flagged?.fault ? (
                      <span className="text-(--status-alarm-strong)"> · {flagged.fault} in fault</span>
                    ) : flagged?.alarm ? (
                      <span className="text-(--status-alarm-strong)"> · {flagged.alarm} in alarm</span>
                    ) : null}
                  </>
                }
                title={`#${d.instance} · ${d.address}${d.vendorName ? ` · ${d.vendorName}` : ''}${d.savedAt ? ` · from a file saved ${d.savedAt.replace('T', ' ')}` : ''}`}
                active={scopeDevice === d.instance}
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
                        <Count className={matched ? 'bg-(--ink) text-(--surface-card)' : ''} title={`${matched} of ${d.objectCount} match`}>
                          {matched}
                        </Count>
                      ) : d.objectCount ? (
                        <Count>{d.objectCount}</Count>
                      ) : null}
                    </>
                  )
                }
                menu={
                  <ItemMenu label={`Actions for ${d.name || d.instance}`}>
                    {reading && job ? (
                      <MenuItem onClick={() => onCancel(job.id)}>
                        <CircleStop />
                        Stop reading
                      </MenuItem>
                    ) : (
                      <>
                        <MenuItem onClick={() => onRead(d.instance)} disabled={!status.connected}>
                          <ReloadIcon />
                          {d.objectCount ? 'Read again' : 'Read all objects'}
                        </MenuItem>
                        {problems > 0 ? (
                          <MenuItem onClick={() => onRead(d.instance, true)} disabled={!status.connected}>
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
                  </ItemMenu>
                }
              >
                {reading ? (
                  <span className="pointer-events-none absolute right-2.5 bottom-[3px] left-[48px] h-[2px] overflow-hidden rounded-full bg-(--surface-track)">
                    <span className="block h-full rounded-full bg-(--ink) transition-[width] duration-300" style={{ width: `${job.total ? Math.max(3, (100 * job.done) / job.total) : 3}%` }} />
                  </span>
                ) : null}
              </Item>
            )
          })}

          {status.connected && !devices.length && !searching && !booting ? (
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
              <Input autoFocus size="sm" placeholder="192.168.1.67" value={ip} onChange={(e) => setIp(e.target.value)} />
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
