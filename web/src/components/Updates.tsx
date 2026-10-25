import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from 'framer-motion'
import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { Hugeicons } from '../ui/components/hugeicons'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'
import { EASE_OUT, LAYOUT, SPRING_SWAP } from '../ui/motion'

/* Self-update, shared by BACon and Rasher (which imports it as @bacon/components/Updates): the status from the
   backend's updater, a ring that fills as the download runs, and the dialog with notes and one button. */

const { AlertCircle, ArrowRight, Check, Download, Info, RotateCw } = Hugeicons

// the ring and its number ride the same spring, so they never disagree
const PROGRESS = { stiffness: 170, damping: 28, mass: 0.6 }

export type UpdateStatus = {
  current: string
  latest: string
  notes: string
  url: string
  published: string
  available: boolean
  canInstall: boolean
  error: string
  state: 'idle' | 'downloading' | 'ready' | 'failed'
  done: number
  total: number
  /** bytes a second while downloading */
  rate: number
}

export type UpdateApi = {
  update: (check?: boolean, force?: boolean) => Promise<UpdateStatus>
  updateDownload: () => Promise<UpdateStatus>
  updateApply: () => Promise<unknown>
}

export type UpdatePhase = 'none' | 'available' | 'downloading' | 'ready' | 'failed'

export const phaseOf = (u: UpdateStatus | null): UpdatePhase =>
  !u?.available ? 'none' : u.state === 'downloading' ? 'downloading' : u.state === 'ready' ? 'ready' : u.state === 'failed' ? 'failed' : 'available'

/** 0–1: how much is downloaded */
export const progressOf = (u: UpdateStatus | null) => (!u ? 0 : u.state === 'ready' ? 1 : u.total ? Math.min(1, u.done / u.total) : 0)

const MB = (n: number) => `${(n / 1048576).toFixed(1)} MB`
const left = (u: UpdateStatus) => {
  if (!u.rate || !u.total) return ''
  const s = (u.total - u.done) / u.rate
  return s < 1.5 ? 'almost done' : s < 60 ? `about ${Math.ceil(s)} s left` : `about ${Math.ceil(s / 60)} min left`
}

/** How far the download is, in words: "8.1 of 19.0 MB · 2.4 MB/s · about 5 s left". */
export function downloadDetail(u: UpdateStatus) {
  if (!u.total) return `${MB(u.done)} so far`
  return [`${MB(u.done)} of ${MB(u.total)}`, u.rate ? `${MB(u.rate)}/s` : '', left(u)].filter(Boolean).join(' · ')
}

/** One line for a tooltip, whatever the update is doing. */
export function updateSummary(app: string, u: UpdateStatus | null) {
  const phase = phaseOf(u)
  if (!u || phase === 'none') return `About ${app}`
  if (phase === 'downloading') return `Downloading ${app} ${u.latest} · ${Math.round(progressOf(u) * 100)}% · ${downloadDetail(u)}`
  if (phase === 'ready') return `${app} ${u.latest} is ready · restart to update`
  if (phase === 'failed') return `The update stopped · ${u.error || 'try again'}`
  return `${app} ${u.latest} is available`
}

/** The tooltip: what it's doing on top, how far underneath. */
export function UpdateTip({ app, update }: { app: string; update: UpdateStatus | null }) {
  const u = update
  const phase = phaseOf(u)
  if (!u || phase !== 'downloading') return <>{updateSummary(app, u)}</>
  return (
    <span className="flex flex-col gap-0.5 whitespace-nowrap tabular-nums">
      <span className="font-medium">
        Downloading {app} {u.latest} · {Math.round(progressOf(u) * 100)}%
      </span>
      <span className="opacity-70">{downloadDetail(u)}</span>
    </span>
  )
}

/** The status, checked once at launch, and followed closely while a download runs, so the ring keeps moving with
 *  the dialog closed. */
export function useUpdates(api: UpdateApi) {
  const [update, setUpdate] = useState<UpdateStatus | null>(null)
  useEffect(() => {
    api.update(true).then(setUpdate).catch(() => {})
  }, [api])
  useEffect(() => {
    if (update?.state !== 'downloading') return
    const t = setInterval(() => api.update().then(setUpdate).catch(() => {}), 250)
    return () => clearInterval(t)
  }, [update?.state, api])
  return [update, setUpdate] as const
}

/** A number that glides to its value rather than jumping, for the percentage. */
function Glide({ value }: { value: number }) {
  const reduce = useReducedMotion()
  const v = useSpring(value, reduce ? { duration: 0 } : PROGRESS)
  useEffect(() => v.set(value), [v, value])
  const text = useTransform(v, (n) => String(Math.round(n)))
  return <motion.span>{text}</motion.span>
}

const SWAP = {
  initial: { opacity: 0, scale: 0.6, filter: 'blur(3px)' },
  animate: { opacity: 1, scale: 1, filter: 'blur(0px)', transition: SPRING_SWAP },
  exit: { opacity: 0, scale: 0.6, filter: 'blur(3px)', transition: { duration: 0.14, ease: EASE_OUT } },
}

/**
 * The ring: a track, an arc that springs round as the download runs, and when it's done a lime disc that grows out
 * of the middle. With no size known yet, a short arc spins. Whatever is inside sits in the middle.
 */
export function ProgressRing({
  value,
  phase,
  size = 28,
  stroke = 2.5,
  color = 'var(--action-primary)',
  children,
}: {
  value: number
  phase: UpdatePhase
  size?: number
  stroke?: number
  color?: string
  children?: ReactNode
}) {
  const reduce = useReducedMotion()
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const arc = useSpring(value, reduce ? { duration: 0 } : PROGRESS)
  useEffect(() => arc.set(value), [arc, value])
  const offset = useTransform(arc, (v) => c * (1 - v))
  const ready = phase === 'ready'
  const failed = phase === 'failed'
  const spinning = phase === 'downloading' && value === 0
  const tone = ready ? 'var(--color-ns-green)' : failed ? 'var(--status-alarm-strong)' : color
  const mid = size / 2

  return (
    <span className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {/* once ready, a soft lime halo breathes out from behind it */}
      {ready && !reduce ? (
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-(--color-ns-green)"
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1.75], opacity: [0.55, 0] }}
          transition={{ duration: 1.5, ease: 'easeOut', repeat: Infinity, repeatDelay: 1.4, delay: 0.5 }}
        />
      ) : null}
      <svg className="absolute inset-0 -rotate-90 overflow-visible" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={mid} cy={mid} r={r} fill="none" stroke="currentColor" strokeOpacity={0.16} strokeWidth={stroke} />
        <motion.circle
          cx={mid}
          cy={mid}
          fill="var(--color-ns-green)"
          initial={false}
          animate={{ r: ready ? r + stroke / 2 : 0 }}
          transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 20, delay: ready ? 0.15 : 0 }}
        />
        {spinning ? (
          <motion.circle
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            stroke={tone}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${c * 0.25} ${c}`}
            style={{ originX: '50%', originY: '50%' }}
            animate={reduce ? undefined : { rotate: 360 }}
            transition={{ duration: 0.9, ease: 'linear', repeat: Infinity }}
          />
        ) : (
          <motion.circle
            cx={mid}
            cy={mid}
            r={r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={c}
            style={{ strokeDashoffset: offset }}
            initial={false}
            animate={{ stroke: tone }}
            transition={{ duration: 0.3 }}
          />
        )}
      </svg>
      <span className="relative inline-grid place-items-center">{children}</span>
    </span>
  )
}

/** What sits inside a ring: the percentage while it downloads, a tick when it's ready, a mark when it stopped. */
function RingCenter({ u, phase, text, icon }: { u: UpdateStatus | null; phase: UpdatePhase; text: string; icon: string }) {
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {phase === 'ready' ? (
        <motion.span key="ready" {...SWAP} initial={{ opacity: 0, scale: 0.3, rotate: -40 }} animate={{ opacity: 1, scale: 1, rotate: 0, transition: { ...SPRING_SWAP, delay: 0.25 } }} className="inline-grid text-[#292929]">
          <Check className={icon} strokeWidth={2.6} />
        </motion.span>
      ) : phase === 'failed' ? (
        <motion.span key="failed" {...SWAP} className="inline-grid text-(--status-alarm-strong)">
          <AlertCircle className={icon} />
        </motion.span>
      ) : (
        <motion.span key="pct" {...SWAP} className={`font-medium tabular-nums tracking-[-0.02em] ${text}`}>
          <Glide value={Math.round(progressOf(u) * 100)} />
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/**
 * The update button's icon, for BACon's rail: an info mark with nothing new, a download arrow when there's an
 * update, the ring with its percentage while it downloads, and the lime tick once it's ready.
 */
export function UpdateGlyph({ update, color }: { update: UpdateStatus | null; color?: string }) {
  const phase = phaseOf(update)
  const ring = phase === 'downloading' || phase === 'ready' || phase === 'failed'
  return (
    <AnimatePresence initial={false} mode="popLayout">
      {ring ? (
        <motion.span key="ring" {...SWAP} className="inline-grid">
          <ProgressRing value={progressOf(update)} phase={phase} size={28} stroke={2.5} color={color}>
            <RingCenter u={update} phase={phase} text="text-[9.5px] leading-none" icon="size-[14px]" />
          </ProgressRing>
        </motion.span>
      ) : (
        <motion.span key={phase} {...SWAP} className="inline-grid">
          {phase === 'available' ? <Download className="size-[19px]" /> : <Info className="size-[19px]" />}
        </motion.span>
      )}
    </AnimatePresence>
  )
}

/**
 * For Rasher's small window and its header: a pill that only appears when there's an update. "Update", then a ring
 * and the percentage while it downloads, then a lime "Restart" once it's ready. Its tooltip always says how far.
 */
export function UpdatePill({ app, update, onClick }: { app: string; update: UpdateStatus | null; onClick: () => void }) {
  const phase = phaseOf(update)
  const ready = phase === 'ready'
  return (
    <AnimatePresence initial={false}>
      {phase !== 'none' ? (
        <motion.span key="pill" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1, transition: SPRING_SWAP }} exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.14 } }} className="inline-flex">
          <Tooltip>
            <TooltipTrigger
              render={
                <motion.button
                  layout
                  transition={LAYOUT}
                  onClick={onClick}
                  className={`nc-press inline-flex h-7 items-center gap-1.5 overflow-hidden rounded-full pr-2.5 pl-1.5 text-[12px] font-medium transition-colors duration-300 ${
                    ready ? 'bg-(--color-ns-green) text-[#292929] shadow-[0_6px_16px_-8px_rgba(120,170,30,0.7)]' : 'bg-(--surface-track) text-(--text-strong) hover:bg-[color-mix(in_srgb,var(--surface-track)_92%,var(--ink))]'
                  }`}
                />
              }
            >
              <motion.span layout="position" className="inline-grid">
                {phase === 'available' ? (
                  <span className="inline-grid size-[18px] place-items-center rounded-full bg-(--action-primary) text-white">
                    <Download className="size-[11px]" strokeWidth={2.4} />
                  </span>
                ) : ready ? (
                  <motion.span initial={{ scale: 0.4, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={SPRING_SWAP} className="inline-grid size-[18px] place-items-center rounded-full bg-[#292929] text-(--color-ns-green)">
                    <Check className="size-[11px]" strokeWidth={2.8} />
                  </motion.span>
                ) : (
                  <ProgressRing value={progressOf(update)} phase={phase} size={18} stroke={2.2} />
                )}
              </motion.span>
              <AnimatePresence initial={false} mode="popLayout">
                <motion.span key={phase} layout="position" initial={{ opacity: 0, y: 4, filter: 'blur(3px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -4, filter: 'blur(3px)' }} transition={{ duration: 0.22, ease: EASE_OUT }} className="whitespace-nowrap tabular-nums">
                  {phase === 'downloading' ? (
                    <>
                      <Glide value={Math.round(progressOf(update) * 100)} />%
                    </>
                  ) : ready ? (
                    'Restart'
                  ) : phase === 'failed' ? (
                    'Retry update'
                  ) : (
                    'Update'
                  )}
                </motion.span>
              </AnimatePresence>
            </TooltipTrigger>
            <TooltipPopup>
              <UpdateTip app={app} update={update} />
            </TooltipPopup>
          </Tooltip>
        </motion.span>
      ) : null}
    </AnimatePresence>
  )
}

/** The ready button: lime, with a light that sweeps across it once when it arrives and an arrow that nudges on hover.
 *  While it restarts, the arrow becomes a turning one. */
function RestartButton({ version, onClick, busy }: { version: string; onClick: () => void; busy: boolean }) {
  const reduce = useReducedMotion()
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={busy}
      initial={{ opacity: 0, scale: 0.9, y: 4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={SPRING_SWAP}
      className="group/restart relative inline-flex h-8 cursor-pointer items-center gap-1.5 overflow-hidden rounded-full border border-(--color-ns-green-light) bg-(--color-ns-green) px-3.5 text-[14px] font-medium whitespace-nowrap text-[#292929] shadow-[0_8px_20px_-10px_rgba(120,170,30,0.85),inset_0_1px_0_rgba(255,255,255,0.5)] outline-none transition-[background-color,transform] duration-150 hover:bg-[color-mix(in_srgb,var(--color-ns-green)_90%,#292929)] focus-visible:ring-[3px] focus-visible:ring-(--color-ns-green)/50 active:translate-y-px active:scale-[0.98] disabled:cursor-default"
    >
      {!reduce ? (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 w-1/2 -skew-x-12 bg-linear-to-r from-transparent via-white/75 to-transparent"
          initial={{ left: '-60%' }}
          animate={{ left: '140%' }}
          transition={{ duration: 0.95, ease: EASE_OUT, delay: 0.35 }}
        />
      ) : null}
      <span className="relative">{busy ? 'Restarting…' : `Restart into ${version}`}</span>
      {busy ? (
        <RotateCw className="relative size-3.5 animate-spin" strokeWidth={2.4} />
      ) : (
        <ArrowRight className="relative size-3.5 transition-transform duration-300 ease-out group-hover/restart:translate-x-0.5" strokeWidth={2.4} />
      )}
    </motion.button>
  )
}

/** About the app and its updates: the version, what's new, how far the download is, and one button at a time. */
export function UpdateDialog({
  app,
  tagline,
  mark,
  api,
  open,
  onOpenChange,
  update,
  onUpdate,
  restartNote,
}: {
  app: string
  tagline: string
  mark: ReactNode
  api: UpdateApi
  open: boolean
  onOpenChange: (o: boolean) => void
  update: UpdateStatus | null
  onUpdate: (u: UpdateStatus) => void
  /** what restarting does, if more than the window closing */
  restartNote?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const u = update
  const phase = phaseOf(u)

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const check = () => run(async () => onUpdate(await api.update(true, true)))
  const download = () => run(async () => onUpdate(await api.updateDownload()))
  const restart = () =>
    run(async () => {
      await api.updateApply()
      setRestarting(true)
    })

  const message = error || (phase === 'failed' ? '' : u?.error) || ''
  const showProgress = phase === 'downloading' || phase === 'ready' || phase === 'failed'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            {mark}
            <div>
              <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">{app}</DialogTitle>
              <p className="m-0 mt-0.5 text-[12px] text-(--text-muted)">
                {tagline} · version {u?.current ?? '…'}
              </p>
            </div>
          </div>
        </DialogHeader>
        <motion.div layout transition={LAYOUT} className="flex flex-col gap-3 border-y border-(--border-subtle) bg-(--surface-card) px-5 py-4 text-[13px]">
          {restarting ? (
            <div className="flex items-center gap-3">
              <ProgressRing value={0} phase="downloading" size={22} stroke={2.4} />
              <p className="m-0 text-(--text-strong)">
                Restarting into {app} {u?.latest}. {restartNote || 'This window closes in a moment.'}
              </p>
            </div>
          ) : phase !== 'none' && u ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-(--text-strong)">
                  {app} {u.latest} is available
                </span>
                {u.published ? <span className="text-[12px] text-(--text-muted)">{new Date(u.published).toLocaleDateString()}</span> : null}
              </div>
              {u.notes ? <div className="max-h-48 overflow-auto rounded-[12px] bg-(--surface-card-muted) px-3 py-2.5 text-[12.5px] whitespace-pre-wrap text-(--text-muted)">{u.notes}</div> : null}
              <AnimatePresence initial={false}>
                {showProgress ? (
                  <motion.div
                    key="progress"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0, transition: SPRING_SWAP }}
                    exit={{ opacity: 0, y: -6, transition: { duration: 0.14 } }}
                    className={`flex items-center gap-3.5 rounded-[14px] px-3.5 py-3 transition-colors duration-500 ${phase === 'ready' ? 'bg-(--color-ns-green-light)' : 'bg-(--surface-card-muted)'}`}
                  >
                    <ProgressRing value={progressOf(u)} phase={phase} size={48} stroke={3.5}>
                      <RingCenter u={u} phase={phase} text="text-[13px] leading-none" icon="size-[20px]" />
                    </ProgressRing>
                    <div className="min-w-0 flex-1">
                      <AnimatePresence initial={false} mode="popLayout">
                        <motion.div key={phase} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE_OUT }}>
                          <div className="font-medium text-(--text-strong)">
                            {phase === 'ready' ? 'Downloaded and checked' : phase === 'failed' ? 'The download stopped' : `Downloading ${app} ${u.latest}`}
                          </div>
                          <div className="mt-0.5 text-[12px] tabular-nums text-(--text-muted)">
                            {phase === 'ready'
                              ? "Its SHA-256 matches. Restart whenever you're ready."
                              : phase === 'failed'
                                ? u.error || 'Try again.'
                                : downloadDetail(u)}
                          </div>
                        </motion.div>
                      </AnimatePresence>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
              {phase === 'ready' && restartNote ? <p className="m-0 text-[12px] text-(--text-muted)">{restartNote}</p> : null}
              {!u.canInstall ? (
                <p className="m-0 text-[12px] text-(--text-muted)">
                  You're running from source, so get it from{' '}
                  <a className="text-(--action-primary) underline-offset-4 hover:underline" href={u.url} target="_blank" rel="noreferrer">
                    the release page
                  </a>
                  .
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-(--text-muted)">{u?.latest && !u.error ? "You're on the latest version." : 'Checks GitHub for new releases.'}</p>
          )}
          {message ? <p className="m-0 text-[12px] text-(--status-alarm-strong)">{message}</p> : null}
        </motion.div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            {phase === 'downloading' ? 'Hide' : 'Close'}
          </Button>
          {phase === 'ready' && u ? (
            <RestartButton version={u.latest} onClick={restart} busy={busy || restarting} />
          ) : phase === 'downloading' ? (
            <Button variant="secondary" size="sm" disabled className="tabular-nums">
              <span>
                Downloading · <Glide value={Math.round(progressOf(u) * 100)} />%
              </span>
            </Button>
          ) : u?.canInstall && phase !== 'none' ? (
            <Button size="sm" onClick={download} loading={busy}>
              {phase === 'failed' ? 'Try again' : 'Update now'}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={check} loading={busy}>
              Check for updates
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
