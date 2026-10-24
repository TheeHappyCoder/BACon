import { useEffect, useRef, useState } from 'react'
import { Button } from '@ui/components/button'
import { Hugeicons } from '@ui/components/hugeicons'

const { Plus, Minus } = Hugeicons

/** Add more devices like this one: each takes the next instance and the next free address, in a window of its own. */
export function AddDevices({ onAdd, align = 'left', up = false }: { onAdd: (count: number) => Promise<void>; align?: 'left' | 'right'; up?: boolean }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={box} className="relative">
      <Button size="xs" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Plus />
        Add devices
      </Button>
      {open ? (
        <div className={`absolute z-50 w-[248px] rounded-[16px] border border-(--border-subtle) bg-(--surface-card) p-3.5 shadow-(--elevation-floating) ${align === 'right' ? 'right-0' : 'left-0'} ${up ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
          <div className="text-[13px] font-medium">Add devices</div>
          <p className="mt-0.5 text-[12px] text-(--text-muted)">Each takes the next instance and the next free address, in its own window.</p>
          <div className="mt-3 flex items-center justify-between">
            <span className="inline-flex h-8 items-center rounded-full bg-(--surface-track) p-[3px]">
              <button aria-label="Fewer" className="inline-flex size-[26px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) disabled:opacity-40" disabled={count <= 1} onClick={() => setCount(count - 1)}>
                <Minus className="size-3.5" />
              </button>
              <span className="w-8 text-center text-[13px] font-medium tabular-nums">{count}</span>
              <button aria-label="More" className="inline-flex size-[26px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) disabled:opacity-40" disabled={count >= 20} onClick={() => setCount(count + 1)}>
                <Plus className="size-3.5" />
              </button>
            </span>
            <Button
              size="sm"
              loading={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  await onAdd(count)
                  setOpen(false)
                } finally {
                  setBusy(false)
                }
              }}
            >
              Add {count}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
