import { motion } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '../ui/components/menu'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { LAYOUT } from '../ui/motion'
import { cn } from '../ui/utils'
import { AppMark, type MarkStatus } from './AppMark'
import { phaseOf, UpdateGlyph, updateSummary, UpdateTip, type UpdateStatus } from './Updates'

const { ChevronDown, Download, FolderOpen, Settings2 } = Hugeicons

export type Place = 'objects' | 'trends' | 'schedules' | 'alarms' | 'network' | 'activity'

/** A count beside a place's name; the tone says whether it needs a look. */
function Count({ n, tone = 'muted' }: { n: number; tone?: 'muted' | 'alarm' | 'info' }) {
  return (
    <span
      className={cn(
        'relative inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] leading-none font-medium tabular-nums',
        tone === 'alarm' ? 'bg-(--status-alarm-strong) text-white' : tone === 'info' ? 'bg-(--color-ns-cyan) text-(--ink)' : 'bg-white/12 text-white',
      )}
    >
      {n}
    </span>
  )
}

function Dot({ className, ping }: { className: string; ping?: boolean }) {
  return (
    <span className="relative inline-flex size-1.5 shrink-0">
      {ping ? <span className={cn('nc-ping absolute inset-0 rounded-full', className)} /> : null}
      <span className={cn('relative inline-flex size-1.5 rounded-full', className)} />
    </span>
  )
}

function NavItem({ label, active, onClick, children, title }: { label: string; active: boolean; onClick: () => void; children?: ReactNode; title?: string }) {
  return (
    <button
      aria-label={title ?? label}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'nc-press relative flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13.5px] tracking-[-0.005em] transition-colors duration-150',
        active ? 'text-white' : 'text-white/55 hover:text-white',
      )}
    >
      {/* the active pill springs between places, like the rail's square did */}
      {active ? <motion.span layoutId="nav-active" transition={LAYOUT} aria-hidden className="absolute inset-0 rounded-full bg-white/12 shadow-[inset_0_1px_0_rgba(255,255,255,.08)]" /> : null}
      <span className="relative">{label}</span>
      {children}
    </button>
  )
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now.toTimeString().slice(0, 8)
}

/**
 * The ink bar across the top: the site on the left, the places in the middle, the BACnet link on the right as
 * Novacore's Live pill (the clock, then the link as a lime or coral badge). Clicking the pill opens the network settings.
 */
export function TopBar({
  host,
  status,
  statusText,
  connected,
  address,
  live,
  place,
  onPlace,
  recording,
  alarms,
  unacked,
  issues,
  capturing,
  held = 0,
  onNetwork,
  update,
  onUpdates,
  onSaveSite,
  onOpenSite,
  canSave,
}: {
  host: string
  status: MarkStatus
  statusText: string
  connected: boolean
  address: string
  /** values on screen refreshed in the last few seconds */
  live: boolean
  place: Place
  onPlace: (p: Place) => void
  recording: boolean
  alarms: number
  unacked: number
  issues: number
  capturing: boolean
  held?: number
  onNetwork: () => void
  update: UpdateStatus | null
  onUpdates: () => void
  onSaveSite: () => void
  onOpenSite: () => void
  canSave: boolean
}) {
  const clock = useClock()
  const busy = status === 'busy'
  return (
    <header className="bx-rail relative z-10 flex h-[52px] shrink-0 items-center gap-2 bg-(--rail-bg) pr-3 pl-3 text-white" data-tone="dark">
      {/* the site: its name, and the file actions under it */}
      <Menu>
        <MenuTrigger
          render={
            <button className="flex h-9 items-center gap-2.5 rounded-[11px] pr-2.5 pl-1.5 transition-colors hover:bg-white/8 data-popup-open:bg-white/10" aria-label="Site" />
          }
        >
          <AppMark size={26} status={status} />
          <span className="flex min-w-0 flex-col items-start leading-none">
            <span className="text-[10.5px] tracking-[0.02em] text-white/45">BACon</span>
            <span className="mt-[3px] max-w-[180px] truncate text-[13.5px] font-medium tracking-[-0.01em]">{host || 'This PC'}</span>
          </span>
          <ChevronDown className="size-3.5 text-white/40" />
        </MenuTrigger>
        <MenuPopup align="start" className="w-56">
          <MenuItem onClick={onOpenSite}>
            <FolderOpen />
            Open a saved site…
          </MenuItem>
          <MenuItem onClick={onSaveSite} disabled={!canSave}>
            <Download />
            Save this site…
          </MenuItem>
          <MenuSeparator />
          <MenuItem onClick={onNetwork}>
            <Settings2 />
            Network settings
          </MenuItem>
        </MenuPopup>
      </Menu>

      <span className="mx-2 h-5 w-px bg-white/12" />

      <nav aria-label="Places" className="flex items-center gap-0.5">
        <NavItem label="Objects" active={place === 'objects'} onClick={() => onPlace('objects')} />
        <NavItem label="Trends" title={recording ? 'Trends · recording' : 'Trends'} active={place === 'trends'} onClick={() => onPlace('trends')}>
          {recording ? <Dot className="bg-(--color-ns-green)" ping /> : null}
        </NavItem>
        <NavItem label="Schedules" active={place === 'schedules'} onClick={() => onPlace('schedules')} />
        <NavItem
          label="Alarms"
          title={['Alarms', alarms ? `${alarms} active` : '', unacked ? `${unacked} unacknowledged` : ''].filter(Boolean).join(' · ')}
          active={place === 'alarms'}
          onClick={() => onPlace('alarms')}
        >
          {alarms ? <Count n={alarms} tone="alarm" /> : unacked ? <Dot className="bg-(--color-ns-yellow)" /> : null}
        </NavItem>
        <NavItem
          label="Activity"
          title={held ? `Activity · BACon holds ${held} priority slot${held === 1 ? '' : 's'}` : 'Activity · what BACon did'}
          active={place === 'activity'}
          onClick={() => onPlace('activity')}
        >
          {held ? <Count n={held} tone="info" /> : null}
        </NavItem>
        <NavItem
          label="Network"
          title={['Network', capturing ? 'capturing' : '', issues ? `${issues} issues` : ''].filter(Boolean).join(' · ')}
          active={place === 'network'}
          onClick={() => onPlace('network')}
        >
          {capturing ? <Dot className="bg-(--status-alarm-strong)" ping /> : null}
          {issues ? <Count n={issues} tone="alarm" /> : null}
        </NavItem>
      </nav>

      <div className="flex-1" />

      {/* the BACnet link, as the Live pill */}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              onClick={onNetwork}
              className="flex h-8 items-center gap-2.5 rounded-full bg-white/8 pr-1 pl-3 text-[12.5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)] transition-colors hover:bg-white/12"
            />
          }
        >
          {connected && address ? <span className="hidden truncate tabular-nums text-white/45 xl:inline">{address}</span> : null}
          <span className="tabular-nums">
            <span className="font-medium">{clock.slice(0, 5)}</span>
            <span className="text-white/40">{clock.slice(5)}</span>
          </span>
          <span
            className={cn(
              'inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium lowercase text-(--ink)',
              !connected ? 'bg-(--color-ns-red)' : busy ? 'bg-(--color-ns-cyan)' : status === 'degraded' ? 'bg-(--color-ns-yellow)' : 'bg-(--color-ns-green)',
            )}
          >
            {connected ? <Dot className="bg-(--ink)" ping={live || busy} /> : null}
            {!connected ? 'offline' : busy ? 'busy' : live ? 'live' : 'online'}
          </span>
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {statusText}
          <div className="text-(--text-muted)">{connected ? (live ? 'Values on screen refresh every 3 s' : 'Showing the last read') : 'Click to connect'}</div>
        </TooltipPopup>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={updateSummary('BACon', update)}
              onClick={onUpdates}
              className="relative inline-flex size-8 items-center justify-center rounded-full text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            />
          }
        >
          <UpdateGlyph update={update} color="var(--color-ns-green)" />
          {phaseOf(update) === 'available' ? <span className="absolute top-1 right-1 size-2 rounded-full border-2 border-(--rail-bg) bg-(--color-ns-green)" /> : null}
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          <UpdateTip app="BACon" update={update} />
        </TooltipPopup>
      </Tooltip>
    </header>
  )
}
