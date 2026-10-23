import { useCallback, useRef, useState } from 'react'

/** One turn of a refresh icon. */
export const TURN_MS = 700
/** Spins a refresh icon at one turn per TURN_MS (the animation is in app.css). */
export const SPIN = 'bx-spin'

/**
 * Refresh buttons spin while their action runs, for at least one full turn, and stop on a whole turn so the icon
 * never snaps back mid-spin. You always see that the click went through, even when the action is instant.
 */
export function useSpin(): [boolean, (action: () => unknown) => Promise<void>] {
  const [spinning, setSpinning] = useState(false)
  const busy = useRef(false)
  const spin = useCallback(async (action: () => unknown) => {
    if (busy.current) return
    busy.current = true
    setSpinning(true)
    const started = performance.now()
    try {
      await action()
    } finally {
      const elapsed = performance.now() - started
      const rest = Math.max(1, Math.ceil(elapsed / TURN_MS)) * TURN_MS - elapsed
      await new Promise((done) => setTimeout(done, rest))
      busy.current = false
      setSpinning(false)
    }
  }, [])
  return [spinning, spin]
}
