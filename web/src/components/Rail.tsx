import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { LAYOUT } from '../ui/motion'
import { AppMark, MARK_STATUS_LABEL, type MarkStatus } from './AppMark'

const { Notification, CalendarClock, CircleDot, Download, Info, LineChart, Radar, WifiCog } = Hugeicons

export type Place = 'objects' | 'trends' | 'schedules' | 'alarms' | 'network'

function RailButton({ label, active, onClick, children, badge }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; badge?: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            onClick={onClick}
            className="nc-press relative inline-flex size-10 items-center justify-center rounded-[12px] text-(--rail-icon) transition-colors duration-150 hover:bg-(--rail-hover) hover:text-(--rail-icon-strong) data-[active=true]:text-(--rail-icon-strong)"
            data-active={active ? 'true' : undefined}
          />
        }
      >
        {/* the active square and the edge bar spring between places */}
        {active ? <motion.span layoutId="rail-active" transition={LAYOUT} className="absolute inset-0 rounded-[12px] bg-(--rail-active)" /> : null}
        {active ? <motion.span layoutId="rail-bar" transition={LAYOUT} aria-hidden className="absolute top-1/2 -left-[6px] h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-(--rail-bar)" /> : null}
        <span className="relative">{children}</span>
        {badge}
      </TooltipTrigger>
      <TooltipPopup side="right">{label}</TooltipPopup>
    </Tooltip>
  )
}

/** The 60px rail: a rounded tray one step below the panel. The mark on top is the health light for the BACnet link. */
export function Rail({
  status,
  statusText,
  place,
  onPlace,
  recording,
  alarms,
  unacked,
  issues,
  capturing,
  onNetwork,
  updateAvailable,
  onUpdates,
  tone = 'dark',
}: {
  tone?: 'dark' | 'white'
  status: MarkStatus
  statusText: string
  place: Place
  onPlace: (p: Place) => void
  recording: boolean
  /** objects in alarm or fault, and how many of those (or of the returned-to-normal) wait for an acknowledgement */
  alarms: number
  unacked: number
  issues: number
  capturing: boolean
  onNetwork: () => void
  updateAvailable: boolean
  onUpdates: () => void
}) {
  return (
    <nav className="w-[60px] shrink-0 p-[6px] pr-0">
      <div className="bx-rail flex h-full flex-col items-center gap-1 rounded-2xl border border-(--rail-border) bg-(--rail-bg) py-3" data-tone={tone}>
        <Tooltip>
          <TooltipTrigger render={<span tabIndex={0} className="mb-3 inline-flex size-[34px] items-center justify-center rounded-[10px] outline-none" />}>
            <AppMark size={26} status={status} />
          </TooltipTrigger>
          <TooltipPopup side="right">{statusText || MARK_STATUS_LABEL[status]}</TooltipPopup>
        </Tooltip>
        <RailButton label="Objects" active={place === 'objects'} onClick={() => onPlace('objects')}>
          <CircleDot className="size-[19px]" />
        </RailButton>
        <RailButton
          label={recording ? 'Trends · recording' : 'Trends'}
          active={place === 'trends'}
          onClick={() => onPlace('trends')}
          badge={recording ? <span className="absolute top-[7px] right-[7px] size-2 rounded-full border-2 border-(--rail-bg) bg-(--status-ok-strong)" /> : null}
        >
          <LineChart className="size-[19px]" />
        </RailButton>
        <RailButton label="Schedules" active={place === 'schedules'} onClick={() => onPlace('schedules')}>
          <CalendarClock className="size-[19px]" />
        </RailButton>
        <RailButton
          label={['Alarms', alarms ? `${alarms} active` : '', unacked ? `${unacked} unacknowledged` : ''].filter(Boolean).join(' · ')}
          active={place === 'alarms'}
          onClick={() => onPlace('alarms')}
          badge={
            alarms ? (
              <span className="absolute top-[3px] right-[3px] inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-(--rail-bg) bg-(--status-alarm-strong) px-1 text-[10px] font-medium text-white">
                {alarms}
              </span>
            ) : unacked ? (
              <span className="absolute top-[7px] right-[7px] size-2 rounded-full border-2 border-(--rail-bg) bg-(--status-warn-strong)" />
            ) : null
          }
        >
          <Notification className="size-[19px]" />
        </RailButton>
        <RailButton
          label={['Network', capturing ? 'capturing' : '', issues ? `${issues} issues` : ''].filter(Boolean).join(' · ')}
          active={place === 'network'}
          onClick={() => onPlace('network')}
          badge={
            <>
              {/* capturing: a pulsing red dot, like the recording dot on Trends; it moves down when the issue count is shown */}
              {capturing ? (
                <span className={`absolute right-[7px] size-2 ${issues ? 'bottom-[7px]' : 'top-[7px]'}`}>
                  <span className="nc-ping absolute inset-0 rounded-full bg-(--status-alarm-strong)" />
                  <span className="absolute -inset-[2px] rounded-full border-2 border-(--rail-bg) bg-(--status-alarm-strong)" />
                </span>
              ) : null}
              {issues ? (
                <span className="absolute top-[3px] right-[3px] inline-flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-(--rail-bg) bg-(--status-alarm-strong) px-1 text-[10px] font-medium text-white">
                  {issues}
                </span>
              ) : null}
            </>
          }
        >
          <Radar className="size-[19px]" />
        </RailButton>
        <div className="flex-1" />
        <RailButton
          label={updateAvailable ? 'Update available' : 'About BACon'}
          onClick={onUpdates}
          badge={updateAvailable ? <span className="absolute top-[7px] right-[7px] size-2 rounded-full border-2 border-(--rail-bg) bg-(--action-primary)" /> : null}
        >
          {updateAvailable ? <Download className="size-[19px]" /> : <Info className="size-[19px]" />}
        </RailButton>
        <RailButton label="Network settings" onClick={onNetwork}>
          <WifiCog className="size-[19px]" />
        </RailButton>
      </div>
    </nav>
  )
}
