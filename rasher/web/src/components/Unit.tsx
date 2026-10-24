import { motion, AnimatePresence } from 'framer-motion'
import type { Running } from '../api'

/**
 * A unit body for a profile's face: white plastic around a black glass display, two touch keys and something in
 * between above the LEDs, as on RC-1. Switched off the glass goes dark; while it boots it shows the model.
 */
export function Unit({ s, model, leds, left, center, right, children }: {
  s: Running
  model: string
  leds: React.ReactNode
  left: React.ReactNode
  center: React.ReactNode
  right: React.ReactNode
  children: React.ReactNode
}) {
  const off = !s.device.powered
  const offline = off || s.device.restarting
  return (
    <div className="rs-unit mx-auto w-[300px] p-[18px] pb-3 select-none">
      <div className="rs-glass aspect-[1/0.92] w-full px-[18px] pt-3.5 pb-3">
        <AnimatePresence>
          {s.device.restarting && !off ? (
            <motion.div key="boot" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2">
              <span className="text-[12px] tracking-[0.18em] uppercase rs-glass-faint">{model}</span>
              <span className="text-[14px]">Starting…</span>
            </motion.div>
          ) : null}
        </AnimatePresence>
        <div className="flex h-full flex-col transition-opacity duration-300" style={{ opacity: offline ? 0 : 1 }}>
          {children}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between px-1">
        {left}
        <div className="flex flex-col items-center gap-1.5">
          {center}
          {leds}
        </div>
        {right}
      </div>
    </div>
  )
}

/** The status row along the top of the glass: what it's doing on the left, the device's clock on the right. */
export function GlassStatus({ children, clock }: { children: React.ReactNode; clock: string }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="inline-flex items-center gap-1.5">{children}</span>
      <span className="tabular-nums rs-glass-faint">{clock}</span>
    </div>
  )
}
