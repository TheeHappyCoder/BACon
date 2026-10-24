import { motion, AnimatePresence } from 'framer-motion'
import { useState } from 'react'
import { Hugeicons } from '@ui/components/hugeicons'
import { useClock } from '../../components/controls'
import { GlassStatus, Unit } from '../../components/Unit'
import type { MeterRunning } from '.'

const { ChevronLeft, ChevronRight } = Hugeicons

const PAGES = ['Power', 'Phases', 'Energy']
const LIMIT = 55 // the demand alarm's high limit, kW

const group = (v: number, digits = 0) => v.toLocaleString('en-GB', { minimumFractionDigits: digits, maximumFractionDigits: digits }).replace(/,/g, ' ')

/** A phase is fine, lost, or measuring backwards (a CT the wrong way round). */
const tone = (v: number, kw: number) => (v < 184 ? '#ff6a5f' : kw < -0.05 ? '#ffc04a' : '#7ddc7a')

/** EM-3 on the DIN rail: a paged display, as real meters have, with ◀ and ▶ to step through it. */
export function MeterUnit({ s, leds }: { s: MeterRunning; leds: React.ReactNode }) {
  const m = s.meter
  const [page, setPage] = useState(0)
  const clock = useClock(s.device.lastSync?.offset ?? 0)
  const offline = !s.device.powered || s.device.restarting
  const demandAlarm = s.points.find((p) => p.key === 'analog-input,3')?.alarm?.state === 'high-limit'
  const [whole, frac] = m.total.toFixed(1).split('.')
  const step = (d: number) => setPage((p) => (p + d + PAGES.length) % PAGES.length)

  return (
    <Unit
      s={s}
      model="EM-3"
      leds={leds}
      left={
        <button className="rs-key size-12" aria-label="Previous page" onClick={() => step(-1)} disabled={offline}>
          <ChevronLeft className="size-[20px]" />
        </button>
      }
      center={<span className="flex h-9 items-center text-[11px] font-medium tracking-[0.08em] text-[#3a3a3e] uppercase">{PAGES[page]}</span>}
      right={
        <button className="rs-key size-12" aria-label="Next page" onClick={() => step(1)} disabled={offline}>
          <ChevronRight className="size-[20px]" />
        </button>
      }
    >
      <GlassStatus clock={clock}>
        {m.phases.map((p, i) => (
          <span key={i} className="mr-1 inline-flex items-center gap-1 tabular-nums">
            <span className="size-[6px] rounded-full" style={{ background: tone(p.v, p.kw) }} />
            <span className="font-medium">L{i + 1}</span>
          </span>
        ))}
      </GlassStatus>

      <div className="flex flex-1 flex-col justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={page} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
            {page === 0 ? (
              <div className="flex flex-col items-center">
                <span className="flex items-start leading-none tabular-nums">
                  <span className="text-[60px] font-light tracking-[-0.05em]">{whole}</span>
                  <span className="mt-[8px] flex flex-col">
                    <span className="text-[19px] font-light rs-glass-faint">kW</span>
                    <span className="-mt-0.5 text-[24px] font-light tracking-[-0.03em]">.{frac}</span>
                  </span>
                </span>
                <div className="mt-2.5 w-[180px]">
                  <div className="relative h-[5px] rounded-full bg-white/12">
                    <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, (m.demand / (LIMIT * 1.4)) * 100)}%`, background: demandAlarm ? '#ff6a5f' : m.demand > LIMIT * 0.9 ? '#ffc04a' : '#f4f4f2' }} />
                    <div className="absolute inset-y-[-3px] w-[2px] rounded-full bg-[#ff8a80]" style={{ left: `${100 / 1.4}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11.5px] tabular-nums rs-glass-faint">
                    <span>Demand <span className={demandAlarm ? 'text-[#ff8a80]' : 'text-[#f4f4f2]'}>{m.demand.toFixed(1)}</span> kW</span>
                    <span>limit {LIMIT}</span>
                  </div>
                </div>
              </div>
            ) : page === 1 ? (
              <table className="w-full text-[12.5px] tabular-nums">
                <thead>
                  <tr className="text-[10.5px] tracking-[0.1em] uppercase rs-glass-mute">
                    <th className="pb-1 text-left font-normal"></th>
                    <th className="pb-1 text-right font-normal">V</th>
                    <th className="pb-1 text-right font-normal">A</th>
                    <th className="pb-1 text-right font-normal">kW</th>
                  </tr>
                </thead>
                <tbody>
                  {m.phases.map((p, i) => (
                    <tr key={i}>
                      <td className="py-[3px]">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="size-[6px] rounded-full" style={{ background: tone(p.v, p.kw) }} />L{i + 1}
                        </span>
                      </td>
                      <td className="text-right">{p.v.toFixed(1)}</td>
                      <td className="text-right">{p.a.toFixed(1)}</td>
                      <td className="text-right" style={{ color: p.kw < -0.05 ? '#ffc04a' : undefined }}>{p.kw.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="flex flex-col items-center">
                <span className="text-[11px] tracking-[0.14em] uppercase rs-glass-faint">Imported</span>
                <span className="mt-1 flex items-baseline leading-none tabular-nums">
                  <span className="text-[40px] font-light tracking-[-0.04em]">{group(Math.floor(m.energy))}</span>
                  <span className="text-[22px] font-light rs-glass-faint">.{Math.floor((m.energy % 1) * 10)}</span>
                </span>
                <span className="mt-1.5 text-[12px] rs-glass-faint">kWh since fitted</span>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-between text-[11.5px] tabular-nums">
        <span className="inline-flex items-baseline gap-1">
          <span>{group(m.energy)}</span>
          <span className="rs-glass-faint">kWh</span>
        </span>
        <span className="inline-flex items-center gap-2.5">
          <span>
            <span className="rs-glass-faint">PF </span>
            <span className={m.pf < 0.85 ? 'text-[#ffc04a]' : undefined}>{m.pf.toFixed(2)}</span>
          </span>
          <span>
            {m.hz.toFixed(2)}
            <span className="rs-glass-faint"> Hz</span>
          </span>
        </span>
      </div>
    </Unit>
  )
}
