import { AnimatePresence, motion } from 'framer-motion'
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react'
import { Hugeicons } from '../ui/components/hugeicons'

const { CheckIcon, AlertTriangle, XIcon, Undo } = Hugeicons

type Toast = { id: number; kind: 'success' | 'error'; message: string; undo?: () => void }
type Push = (message: string, options?: { kind?: Toast['kind']; undo?: () => void }) => void

const ToastContext = createContext<Push>(() => {})

export function useToast(): Push {
  return useContext(ToastContext)
}

/** Top-centre white pills. Success auto-dismisses after 5s; an error stays until it is read and closed. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), [])

  const push = useCallback<Push>(
    (message, options) => {
      const id = ++nextId.current
      const kind = options?.kind ?? 'success'
      setToasts((all) => [...all.slice(-2), { id, kind, message, undo: options?.undo }])
      if (kind === 'success') setTimeout(() => dismiss(id), 5000)
    },
    [dismiss],
  )

  const value = useMemo(() => push, [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[1200] flex flex-col items-center gap-2">
        <AnimatePresence initial={false}>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -12, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(6px)', transition: { duration: 0.18 } }}
              transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="pointer-events-auto flex max-w-[min(640px,calc(100vw-24px))] items-center gap-2.5 rounded-full border border-(--border-subtle) bg-(--surface-card) py-1.5 pl-2 pr-1.5 text-[13px] shadow-(--shadow-popover)"
              role={t.kind === 'error' ? 'alert' : 'status'}
            >
              <span
                className={
                  t.kind === 'error'
                    ? 'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-(--status-alarm-bg)'
                    : 'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-(--status-ok-bg)'
                }
              >
                {t.kind === 'error' ? (
                  <AlertTriangle className="size-3.5 text-(--status-alarm-strong)" />
                ) : (
                  <CheckIcon className="size-3.5 text-(--status-ok-strong)" />
                )}
              </span>
              <span className="min-w-0 leading-snug">{t.message}</span>
              {t.undo ? (
                <button
                  className="nc-press inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-(--surface-track) px-3 text-[12px] font-medium transition-colors hover:bg-(--paper-3)"
                  onClick={() => {
                    t.undo?.()
                    dismiss(t.id)
                  }}
                >
                  <Undo className="size-3.5" />
                  Undo
                </button>
              ) : null}
              <button
                aria-label="Dismiss"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-(--text-faint) transition-colors hover:bg-(--surface-hover) hover:text-(--text-strong)"
                onClick={() => dismiss(t.id)}
              >
                <XIcon className="size-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}
