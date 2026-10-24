import { useCallback, useEffect, useRef, useState } from 'react'
import { ToastProvider, useToast } from '@bacon/components/Toasts'
import { api, bridge, type Activity, type Control, type DeviceSummary, type State } from './api'
import { Setup } from './components/Setup'
import { Compact } from './views/Compact'
import { Expanded } from './views/Expanded'

const fromUrl = () => {
  const d = new URLSearchParams(location.search).get('d')
  return d ? Number(d) : null
}

/** pywebview injects its API a moment after the page loads; resolve once it's there (or quickly, in a browser). */
function whenBridge(): Promise<ReturnType<typeof bridge>> {
  if (bridge()) return Promise.resolve(bridge())
  return new Promise((resolve) => {
    const done = () => resolve(bridge())
    window.addEventListener('pywebviewready', done, { once: true })
    setTimeout(done, 1500)
  })
}

/** In a browser there are no windows per device, so a little switcher stands in for them. */
function Switcher({ current, onPick }: { current: number; onPick: (instance: number) => void }) {
  const [list, setList] = useState<DeviceSummary[]>([])
  useEffect(() => {
    const load = () => api.devices().then(setList).catch(() => {})
    load()
    const t = setInterval(load, 3000)
    return () => clearInterval(t)
  }, [])
  if (list.length < 2) return null
  return (
    <select
      aria-label="Device"
      className="h-7 rounded-full border border-(--border-subtle) bg-(--surface-card) px-2 text-[12px] text-(--text-strong) outline-none"
      value={current}
      onChange={(e) => onPick(Number(e.target.value))}
    >
      {list.map((d) => (
        <option key={d.instance} value={d.instance}>
          {d.name}
          {d.powered ? '' : ' (off)'}
        </option>
      ))}
    </select>
  )
}

function DeviceScreen({ instance, onGone, onPick }: { instance: number; onGone: () => void; onPick: (instance: number) => void }) {
  const toast = useToast()
  const [state, setState] = useState<State | null>(null)
  const [activity, setActivity] = useState<Activity[]>([])
  const [expanded, setExpanded] = useState(false)
  const lastId = useRef(0)

  useEffect(() => {
    setActivity([])
    lastId.current = 0
    setState(null)
  }, [instance])

  const poll = useCallback(async () => {
    try {
      const s = await api.state(instance, lastId.current)
      if (s.running && s.activity.length) {
        lastId.current = s.activity[s.activity.length - 1].id
        setActivity((a) => [...a, ...s.activity].slice(-500))
      }
      setState(s)
    } catch {
      /* the next poll will tell */
    }
  }, [instance])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 700)
    return () => clearInterval(t)
  }, [poll])

  useEffect(() => {
    if (state && !state.running) onGone()
  }, [state, onGone])

  useEffect(() => {
    if (state?.running) bridge()?.title(`${state.device.name} · Rasher`)
  }, [state?.running, state && state.running && state.device.name]) // eslint-disable-line react-hooks/exhaustive-deps

  const control = useCallback(
    async (c: Control) => {
      try {
        await api.control(instance, c)
        await poll()
      } catch (e) {
        toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
      }
    },
    [instance, poll, toast],
  )

  const add = async (count: number) => {
    try {
      const res = await api.add(count)
      if (!bridge()) toast(`Added ${res.instances.length === 1 ? `device ${res.instances[0]}` : `devices ${res.instances[0]}–${res.instances[res.instances.length - 1]}`}. Switch to them from the list at the bottom.`)
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  const expand = (on: boolean) => {
    setExpanded(on)
    bridge()?.expand(on)
  }

  if (!state?.running) return <div className="h-screen bg-(--surface-page)" />
  const network = activity.filter((a) => a.kind !== 'local' && a.source !== 'Rasher' && a.source !== 'Room').length
  const switcher = bridge() ? null : <Switcher current={instance} onPick={onPick} />

  return expanded ? (
    <Expanded s={state} activity={activity} network={network} control={control} onCollapse={() => expand(false)} onAdd={add} switcher={switcher} />
  ) : (
    <Compact s={state} control={control} onExpand={() => expand(true)} onAdd={add} switcher={switcher} activityCount={network} />
  )
}

function Root() {
  const [instance, setInstance] = useState<number | null>(fromUrl())
  const [ready, setReady] = useState(instance !== null)

  const show = useCallback(async (i: number) => {
    history.replaceState(null, '', `?d=${i}`)
    setInstance(i)
    setReady(true)
    ;(await whenBridge())?.bind(i)
  }, [])

  // no device in the address: show the first one running, or set one up
  useEffect(() => {
    if (instance !== null) return
    api
      .devices()
      .then((list) => (list.length ? show(list[0].instance) : setReady(true)))
      .catch(() => setReady(true))
  }, [instance, show])

  const gone = useCallback(() => {
    history.replaceState(null, '', '/')
    setInstance(null)
    setReady(false)
  }, [])

  if (!ready) return <div className="h-screen bg-(--surface-page)" />
  if (instance === null) {
    return (
      <div className="flex h-screen flex-col bg-(--surface-page) text-(--text-strong)">
        <Setup onStarted={show} />
      </div>
    )
  }
  return <DeviceScreen instance={instance} onGone={gone} onPick={show} />
}

export default function App() {
  return (
    <ToastProvider>
      <Root />
    </ToastProvider>
  )
}
