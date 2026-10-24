import { useEffect, useRef, useState } from 'react'
import type { Running } from '../api'

/** True for a moment whenever `count` goes up: the LED's flicker for each request the device answers. */
function usePulse(count: number) {
  const [on, setOn] = useState(false)
  const last = useRef(count)
  useEffect(() => {
    if (count === last.current) return
    last.current = count
    setOn(true)
    const t = setTimeout(() => setOn(false), 120)
    return () => clearTimeout(t)
  }, [count])
  return on
}

/** The device's two LEDs, the same on every face: one flickers with each request answered, the other shows booting
 *  (amber) and alarms (blinking). Each profile's face puts them at the bottom centre of its unit. */
export function Leds({ s, activityCount }: { s: Running; activityCount: number }) {
  const off = !s.device.powered
  const offline = off || s.device.restarting
  const pulse = usePulse(activityCount)
  const inAlarm = s.points.some((p) => p.alarm && p.alarm.state !== 'normal')
  return (
    <span className="flex items-center gap-1.5">
      <span className="rs-led size-[5px]" data-on={pulse && !offline} />
      <span className={`rs-led size-[5px] ${!off && inAlarm ? 'rs-blink' : ''}`} data-tone={off ? undefined : s.device.restarting ? 'amber' : inAlarm ? 'alarm' : undefined} />
    </span>
  )
}
