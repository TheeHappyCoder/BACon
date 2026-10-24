import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Control, Point } from '../../api'
import { useClock } from '../../components/controls'
import { GlassStatus, Unit } from '../../components/Unit'
import type { VavRunning } from '.'

const { Minus, Plus, Users, Sun, Moon, Clock, Flame, Snowflake, AlertTriangle } = Hugeicons

const MODE_ICON: Record<string, typeof Sun> = { Occupied: Sun, Standby: Clock, Unoccupied: Moon }
const SEGMENTS = 24

/** A round damper seen down the duct: the blade turns from across the airflow (closed) to along it (open). */
function DamperGlyph({ open }: { open: number }) {
  return (
    <svg viewBox="0 0 24 24" className="size-[15px]" aria-hidden>
      <circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" strokeOpacity="0.45" strokeWidth="1.5" />
      <g style={{ transform: `rotate(${90 - Math.max(0, Math.min(100, open)) * 0.9}deg)`, transformOrigin: '12px 12px', transition: 'transform 700ms ease' }}>
        <rect x="4.5" y="10.6" width="15" height="2.8" rx="1.4" fill="currentColor" />
      </g>
      <circle cx="12" cy="12" r="1.5" fill="#141417" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  )
}

/** Airflow on a segmented scale up to the box's maximum, like the FCU's offset scale: filled with what's flowing,
 *  the setpoint's segment standing taller, amber when the duct can't deliver it. */
function AirflowScale({ flow, sp, max, short }: { flow: number; sp: number; max: number; short: boolean }) {
  const at = (v: number) => Math.round((Math.max(0, Math.min(v, max)) / Math.max(max, 1)) * SEGMENTS)
  const filled = at(flow)
  const mark = Math.max(1, at(sp))
  const fill = short ? '#ffc04a' : '#6fb4ff'
  return (
    <div className="mb-2.5">
      <div className="flex items-end justify-center gap-[3px]" aria-hidden>
        {Array.from({ length: SEGMENTS }, (_, i) => i + 1).map((i) => (
          <span
            key={i}
            className="w-[5px] rounded-[1.5px] transition-colors duration-500"
            style={{ height: i === mark ? 12 : 6, background: i <= filled ? fill : i === mark ? '#f4f4f2' : 'rgb(244 244 242 / 0.16)' }}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-center gap-1.5 text-[11.5px] tabular-nums">
        <span className={short ? 'text-[#ffc04a]' : undefined}>{Math.round(flow)} l/s</span>
        <span className="rs-glass-faint">· set {Math.round(sp)}</span>
      </div>
    </div>
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
  const max = Number(pt('analog-value,5').value ?? 350)
  const mode = pt('multi-state-value,1')
  const ModeIcon = MODE_ICON[mode.display] ?? Sun
  const fault = temp.reliability !== 'no-fault-detected'
  const offline = !s.device.powered || s.device.restarting
  const localMode = mode.activePriority === 8
  const clock = useClock(s.device.lastSync?.offset ?? 0)
  const short = z.flowSp > 20 && z.flow < z.flowSp * 0.85
  const heating = z.reheat > 0.5
  const cooling = z.coolLoop > 0.5

  // after a key press the setpoint stands out for a moment, as on RC-1
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

      {/* the zone temperature, or the setpoint for a moment after - or + */}
      <div className="flex flex-1 flex-col items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          {touched ? (
            <motion.div key="sp" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="flex flex-col items-center">
              <span className="text-[11px] tracking-[0.14em] uppercase rs-glass-faint">Setpoint</span>
              <span className="text-[58px] leading-none font-light tracking-[-0.04em] tabular-nums">
                {sp.toFixed(1)}
                <span className="align-top text-[22px] rs-glass-faint">°</span>
              </span>
              <span className="mt-1 text-[12px] tabular-nums rs-glass-faint">{offset > 0 ? '+' : ''}{offset.toFixed(1)} K</span>
            </motion.div>
          ) : (
            <motion.div key="t" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }} className="flex flex-col items-center">
              <span className="flex items-start leading-none tabular-nums">
                <span className="text-[66px] font-light tracking-[-0.05em]">{whole}</span>
                <span className="mt-[9px] flex flex-col">
                  <span className="text-[22px] font-light rs-glass-faint">°C</span>
                  <span className="-mt-0.5 text-[26px] font-light tracking-[-0.03em]">.{frac}</span>
                </span>
              </span>
              <span className="mt-1.5 text-[12px] tabular-nums rs-glass-faint">
                {fault ? <span className="text-[#ff8a80]">Sensor fault</span> : <>Set {sp.toFixed(1)}°</>}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <AirflowScale flow={z.flow} sp={z.flowSp} max={max} short={short} />

      {/* bottom row: the damper on the left, what the box is doing on the right */}
      <div className="flex items-center justify-between text-[11.5px] tabular-nums">
        <span className="inline-flex items-center gap-1.5" aria-label={`Damper ${Math.round(z.damper)} % open`}>
          <DamperGlyph open={z.damper} />
          <span>{Math.round(z.damper)}</span>
          <span className="rs-glass-faint">%</span>
        </span>
        <span className="inline-flex items-center gap-2.5">
          {short ? <AlertTriangle className="size-[14px] text-[#ffc04a]" aria-label="Airflow short of its setpoint" /> : null}
          {z.people > 0 ? <Users className="size-[14px]" aria-label="Someone in the zone" /> : null}
          {cooling ? <Snowflake className="size-[14px] text-[#6fb4ff]" aria-label="Cooling" /> : null}
          {heating ? (
            <span className="inline-flex items-center gap-1 text-[#ff9c5b]" aria-label="Reheat">
              <Flame className="size-[14px]" />
              {Math.round(z.reheat)}%
            </span>
          ) : null}
        </span>
      </div>
    </Unit>
  )
}
