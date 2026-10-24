import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Control, Point } from '../../api'
import { useClock } from '../../components/controls'
import { GlassStatus, Unit } from '../../components/Unit'
import type { VavRunning } from '.'

const { Minus, Plus, Users, Sun, Moon, Clock, Flame } = Hugeicons

const MODE_ICON: Record<string, typeof Sun> = { Occupied: Sun, Standby: Clock, Unoccupied: Moon }

/** The box as the duct sees it: the damper blade at its real angle, the reheat coil glowing with the valve, and air
 *  running faster the more of it there is. */
function Duct({ damper, reheat, flow }: { damper: number; reheat: number; flow: number }) {
  const angle = damper * 0.9 // closed is across the duct (0), open is along it (90)
  const period = flow < 5 ? 0 : Math.max(0.25, 60 / flow)
  const glow = reheat > 0.5 ? `rgb(255 156 91 / ${0.35 + (0.65 * reheat) / 100})` : 'rgb(244 244 242 / 0.22)'
  return (
    <svg viewBox="0 0 228 30" className="w-full" aria-hidden>
      <rect x="0.5" y="5.5" width="227" height="19" rx="5" fill="none" stroke="rgb(244 244 242 / 0.18)" />
      <line className="rs-flow" data-still={period === 0} x1="4" y1="15" x2="224" y2="15" stroke="rgb(111 180 255 / 0.55)" strokeWidth="1.6" strokeDasharray="3 9" strokeLinecap="round" style={{ ['--rs-flow' as string]: `${period}s` }} />
      <g transform={`rotate(${angle} 74 15)`}>
        <line x1="74" y1="7" x2="74" y2="23" stroke="#f4f4f2" strokeWidth="2.4" strokeLinecap="round" />
      </g>
      <circle cx="74" cy="15" r="1.8" fill="#141417" stroke="#f4f4f2" strokeWidth="1.1" />
      <path d="M150 8 l5 14 l5 -14 l5 14 l5 -14 l5 14" fill="none" stroke={glow} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

/** VC-1's zone sensor and box: the zone temperature, the airflow against its setpoint, - and + for the setpoint
 *  offset, and Here for occupied now (priority 8). */
export function VavUnit({ s, control, leds }: { s: VavRunning; control: (c: Control) => void; leds: React.ReactNode }) {
  const pt = (k: string) => s.points.find((p) => p.key === k) as Point
  const z = s.zone
  const temp = pt('analog-input,1')
  const offset = Number(pt('analog-value,2').value ?? 0)
  const base = Number(pt('analog-value,1').value ?? 21)
  const mode = pt('multi-state-value,1')
  const ModeIcon = MODE_ICON[mode.display] ?? Sun
  const fault = temp.reliability !== 'no-fault-detected'
  const offline = !s.device.powered || s.device.restarting
  const localMode = mode.activePriority === 8
  const clock = useClock(s.device.lastSync?.offset ?? 0)
  const short = z.flowSp > 20 && z.flow < z.flowSp * 0.85

  const [touched, setTouched] = useState(0)
  useEffect(() => {
    if (!touched) return
    const t = setTimeout(() => setTouched(0), 2200)
    return () => clearTimeout(t)
  }, [touched])
  const press = (d: number) => {
    control({ action: 'offset', value: Math.max(-3, Math.min(3, offset + d)) })
    setTouched(Date.now())
  }
  const [whole, frac] = (fault ? '--.-' : Number(temp.value).toFixed(1)).split('.')
  const sp = base + offset

  return (
    <Unit
      s={s}
      model="VC-1"
      leds={leds}
      left={
        <button className="rs-key size-12" aria-label="Lower the setpoint" onClick={() => press(-0.5)} disabled={offline}>
          <Minus className="size-[20px]" />
        </button>
      }
      center={
        <button
          className="rs-key h-9 px-4 text-[11px] font-medium tracking-[0.08em] uppercase"
          aria-label="Presence: occupied here and now"
          onClick={() => (localMode ? control({ action: 'release', key: 'multi-state-value,1', priority: 8 }) : control({ action: 'write', key: 'multi-state-value,1', value: 1, priority: 8 }))}
          disabled={offline}
        >
          <Users className="mr-1.5 size-[15px]" />
          {localMode ? 'Auto' : 'Here'}
        </button>
      }
      right={
        <button className="rs-key size-12" aria-label="Raise the setpoint" onClick={() => press(0.5)} disabled={offline}>
          <Plus className="size-[20px]" />
        </button>
      }
    >
      <GlassStatus clock={clock}>
        <ModeIcon className="size-[14px]" />
        <span className="font-medium tracking-[-0.01em]">{mode.display}</span>
        {localMode ? <span className="rounded-full bg-white/12 px-1.5 text-[10px] leading-4 rs-glass-faint">here</span> : null}
      </GlassStatus>

      <div className="flex flex-1 flex-col items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          {touched ? (
            <motion.div key="sp" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="flex flex-col items-center">
              <span className="text-[11px] tracking-[0.14em] uppercase rs-glass-faint">Setpoint</span>
              <span className="text-[50px] leading-none font-light tracking-[-0.04em] tabular-nums">
                {sp.toFixed(1)}
                <span className="align-top text-[20px] rs-glass-faint">°</span>
              </span>
              <span className="mt-1 text-[12px] tabular-nums rs-glass-faint">{offset > 0 ? '+' : ''}{offset.toFixed(1)} K</span>
            </motion.div>
          ) : (
            <motion.div key="t" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="flex flex-col items-center">
              <span className="flex items-start leading-none tabular-nums">
                <span className="text-[56px] font-light tracking-[-0.05em]">{whole}</span>
                <span className="mt-[7px] flex flex-col">
                  <span className="text-[19px] font-light rs-glass-faint">°C</span>
                  <span className="-mt-0.5 text-[22px] font-light tracking-[-0.03em]">.{frac}</span>
                </span>
              </span>
              <span className="mt-1 text-[12px] tabular-nums rs-glass-faint">
                {fault ? <span className="text-[#ff8a80]">Sensor fault</span> : <>Set {sp.toFixed(1)}°</>}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <Duct damper={z.damper} reheat={z.reheat} flow={z.flow} />
      <div className="mt-1.5 flex items-center justify-between text-[11.5px] tabular-nums">
        <span className="inline-flex items-baseline gap-1">
          <span className={short ? 'text-[#ffc04a]' : undefined}>{Math.round(z.flow)}</span>
          <span className="rs-glass-faint">/ {Math.round(z.flowSp)} l/s</span>
        </span>
        <span className="inline-flex items-center gap-2.5">
          <span>
            <span className="rs-glass-faint">Damper </span>
            {Math.round(z.damper)}%
          </span>
          <span className={`inline-flex items-center gap-1 ${z.reheat > 0.5 ? 'text-[#ff9c5b]' : 'rs-glass-faint'}`}>
            <Flame className="size-[13px]" />
            {Math.round(z.reheat)}%
          </span>
        </span>
      </div>
    </Unit>
  )
}
