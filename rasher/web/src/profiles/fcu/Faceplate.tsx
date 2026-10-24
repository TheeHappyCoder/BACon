import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import type { Control, Point } from '../../api'
import { useClock } from '../../components/controls'
import type { FcuRunning } from '.'

const { Minus, Plus, Flame, Snowflake, Users, Wind, Sun, Moon, Clock } = Hugeicons

const MODE_ICON: Record<string, typeof Sun> = { Comfort: Sun, Standby: Clock, Economy: Moon, 'Frost protection': Snowflake }

function FanGlyph({ speed }: { speed: number }) {
  // blades turn faster at higher speeds; bars beside it show the step
  const period = [0, 1.6, 0.9, 0.45][speed] ?? 0
  return (
    <span className="inline-flex items-center gap-1">
      <svg viewBox="0 0 24 24" className="size-[15px]" aria-hidden>
        <g className="rs-fan" data-speed={speed} style={{ ['--rs-fan' as string]: `${period}s` }}>
          {[0, 120, 240].map((r) => (
            <path key={r} d="M12 12c0-4 1.2-7 3.4-7S18 7.6 15 10.2 12 12 12 12z" fill="currentColor" transform={`rotate(${r} 12 12)`} />
          ))}
        </g>
        <circle cx="12" cy="12" r="1.6" fill="#141417" stroke="currentColor" strokeWidth="1.2" />
      </svg>
      <span className="flex items-end gap-[2px]" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className="w-[3px] rounded-[1px]" style={{ height: 3 + i * 3, background: i <= speed ? 'currentColor' : 'rgb(244 244 242 / 0.18)' }} />
        ))}
      </span>
    </span>
  )
}

const co2Tone = (ppm: number) => (ppm >= 1200 ? '#ff6a5f' : ppm >= 900 ? '#ffc04a' : '#7ddc7a')

/** RC-1 on the wall: the display, - and + for the setpoint offset, and Here for comfort now (priority 8). */
export function Faceplate({ s, control, leds }: { s: FcuRunning; control: (c: Control) => void; leds: React.ReactNode }) {
  const pt = (k: string) => s.points.find((p) => p.key === k) as Point
  const temp = pt('analog-input,1')
  const offset = Number(pt('analog-value,2').value ?? 0)
  const base = Number(pt('analog-value,1').value ?? 21)
  const mode = pt('multi-state-value,1')
  const fan = pt('multi-state-output,1')
  const modeName = mode.display
  const ModeIcon = MODE_ICON[modeName] ?? Sun
  const fault = temp.reliability !== 'no-fault-detected'
  const off = !s.device.powered
  const offline = off || s.device.restarting
  const clock = useClock(s.device.lastSync?.offset ?? 0)
  const fanSpeed = Math.max(0, (fan.states ?? []).indexOf(fan.display))
  const heating = s.room.heat > 0.5
  const cooling = s.room.cool > 0.5
  const localMode = mode.activePriority === 8

  // after a key press the setpoint stands out for a moment, like a real unit
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
  const onPresence = () =>
    localMode ? control({ action: 'release', key: 'multi-state-value,1', priority: 8 }) : control({ action: 'write', key: 'multi-state-value,1', value: 1, priority: 8 })

  const [whole, frac] = (fault ? '--.-' : Number(temp.value).toFixed(1)).split('.')
  const sp = s.room.heatSp === 8 ? 8 : base + offset

  return (
    <div className="rs-unit mx-auto w-[300px] p-[18px] pb-3 select-none">
      <div className="rs-glass aspect-[1/0.92] w-full px-[18px] pt-3.5 pb-3">
        <AnimatePresence>
          {s.device.restarting && !off ? (
            <motion.div key="boot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
              <span className="text-[12px] tracking-[0.18em] uppercase rs-glass-faint">RC-1</span>
              <span className="text-[14px]">Starting…</span>
            </motion.div>
          ) : null}
        </AnimatePresence>

        {/* switched off the screen is just glass; while it boots the boot screen shows instead */}
        <div className="flex h-full flex-col transition-opacity duration-300" style={{ opacity: offline ? 0 : 1 }}>
          {/* status row */}
          <div className="flex items-center justify-between text-[12px]">
            <span className="inline-flex items-center gap-1.5">
              <ModeIcon className="size-[14px]" />
              <span className="font-medium tracking-[-0.01em]">{modeName}</span>
              {localMode ? <span className="rounded-full bg-white/12 px-1.5 text-[10px] leading-4 rs-glass-faint">here</span> : null}
            </span>
            <span className="tabular-nums rs-glass-faint">{clock}</span>
          </div>

          {/* the temperature */}
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

          {/* offset scale: -3 .. +3 in half steps */}
          <div className="mb-2.5 flex items-end justify-center gap-[3px]" aria-hidden>
            {Array.from({ length: 13 }, (_, i) => (i - 6) / 2).map((v) => {
              const active = offset === 0 ? v === 0 : (offset > 0 ? v > 0 && v <= offset : v < 0 && v >= offset)
              return <span key={v} className="w-[5px] rounded-[1.5px]" style={{ height: v === 0 ? 10 : 6, background: active ? (v > 0 ? '#ff9c5b' : v < 0 ? '#6fb4ff' : '#f4f4f2') : 'rgb(244 244 242 / 0.16)' }} />
            })}
          </div>

          {/* bottom row */}
          <div className="flex items-center justify-between text-[11.5px] tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-[7px] rounded-full" style={{ background: co2Tone(s.room.co2) }} />
              <span>{s.room.co2}</span>
              <span className="rs-glass-faint">ppm</span>
            </span>
            <span className="inline-flex items-center gap-2.5">
              {s.room.window ? <Wind className="size-[14px] text-[#6fb4ff]" aria-label="Window open" /> : null}
              {s.room.people > 0 ? <Users className="size-[14px]" aria-label="Someone in the room" /> : null}
              {heating ? <Flame className="size-[14px] text-[#ff9c5b]" aria-label="Heating" /> : null}
              {cooling ? <Snowflake className="size-[14px] text-[#6fb4ff]" aria-label="Cooling" /> : null}
              <FanGlyph speed={fanSpeed} />
            </span>
          </div>
        </div>
      </div>

      {/* touch keys and the LED */}
      <div className="mt-3 flex items-center justify-between px-1">
        <button className="rs-key size-12" aria-label="Lower the setpoint" onClick={() => press(-0.5)} disabled={offline}>
          <Minus className="size-[20px]" />
        </button>
        <div className="flex flex-col items-center gap-1.5">
          <button className="rs-key h-9 px-4 text-[11px] font-medium tracking-[0.08em] uppercase" aria-label="Presence: comfort here and now" onClick={onPresence} disabled={offline}>
            <Users className="mr-1.5 size-[15px]" />
            {localMode ? 'Auto' : 'Here'}
          </button>
          {leds}
        </div>
        <button className="rs-key size-12" aria-label="Raise the setpoint" onClick={() => press(0.5)} disabled={offline}>
          <Plus className="size-[20px]" />
        </button>
      </div>
    </div>
  )
}
