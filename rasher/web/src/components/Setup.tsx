import { useEffect, useState } from 'react'
import { Button } from '@ui/components/button'
import { Hugeicons } from '@ui/components/hugeicons'
import { Input } from '@ui/components/input'
import { api, type IpCheck, type Setup as SetupData } from '../api'
import { RasherMark } from './RasherMark'

const { CheckIcon, AlertTriangle, Shield } = Hugeicons

const suggest = (ip: string) => {
  const parts = ip.split('.')
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.230` : ''
}

function Label({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-1.5">
      <div className="text-[13px] font-medium">{children}</div>
      {hint ? <div className="text-[12px] text-(--text-muted)">{hint}</div> : null}
    </div>
  )
}

/** Put a controller on the network: pick the equipment (when there's a choice) and the adapter, give it an address of
 *  its own and test it, name it, start. */
export function Setup({ onStarted }: { onStarted: (instance: number) => void }) {
  const [data, setData] = useState<SetupData | null>(null)
  const [adapter, setAdapter] = useState('')
  const [mode, setMode] = useState<'extra' | 'own'>('extra')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('47809')
  const [prefix, setPrefix] = useState('RC')
  const [instance, setInstance] = useState('2001')
  const [type, setType] = useState('fcu')
  const [check, setCheck] = useState<IpCheck | null>(null)
  const [testing, setTesting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.setup().then((d) => {
      setData(d)
      const s = d.settings
      const a = d.adapters.find((x) => x.name === s.adapter) ?? d.adapters.find((x) => x.up) ?? d.adapters[0]
      setAdapter(a?.name ?? '')
      // always offer an address of its own first: acting like a controller on the LAN is the point
      setIp(s.ip || (a ? suggest(a.ip) : ''))
      setPrefix(s.prefix)
      setInstance(String(s.instance))
      setType(d.profiles.some((p) => p.type === s.type) ? s.type : (d.profiles[0]?.type ?? 'fcu'))
      if (s.port !== 47808) setPort(String(s.port))
    })
  }, [])

  const a = data?.adapters.find((x) => x.name === adapter)
  useEffect(() => setCheck(null), [ip, adapter])

  const test = async () => {
    setTesting(true)
    setError('')
    try {
      setCheck(await api.test(ip, adapter))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  const start = async () => {
    setStarting(true)
    setError('')
    try {
      const res = await api.start({ adapter, mode, ip, port: Number(port) || 47809, instance: Number(instance), prefix, type })
      onStarted(res.instance)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const choice = (data?.profiles.length ?? 0) > 1
  const ready = !!a && !!prefix.trim() && /^\d+$/.test(instance) && (mode === 'own' ? /^\d+$/.test(port) : check?.state === 'free')

  return (
    <div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-3 sm:items-center sm:p-6">
      <div className="w-full max-w-[560px] rounded-[22px] border border-(--border-subtle) bg-(--surface-card) p-5 shadow-(--shadow-sheet) sm:p-7">
        <div className="flex items-center gap-3">
          <RasherMark size={34} state="stopped" />
          <div>
            <h1 className="text-[18px] leading-tight font-medium tracking-[-0.02em] sm:text-[22px]">{choice ? 'Put a controller on your network' : 'Put a room controller on your network'}</h1>
            <p className="text-[13px] text-(--text-muted)">A BACnet/IP device you can see, touch and break, next to the tools you're testing.</p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          {choice ? (
            <div>
              <Label>Equipment</Label>
              <div className="flex flex-wrap gap-2">
                {data!.profiles.map((p) => (
                  <button
                    key={p.type}
                    onClick={() => {
                      setType(p.type)
                      setPrefix(p.prefix)
                    }}
                    className={`rounded-[12px] border px-3 py-2 text-left text-[13px] transition-colors ${type === p.type ? 'border-(--action-primary) bg-(--color-primary-50)' : 'border-(--border-subtle) hover:border-(--border-default)'}`}
                  >
                    <span className="font-medium">{p.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <Label>Network adapter</Label>
            <div className="flex flex-wrap gap-2">
              {(data?.adapters ?? []).map((x) => (
                <button
                  key={x.name}
                  onClick={() => {
                    setAdapter(x.name)
                    setIp(suggest(x.ip))
                  }}
                  className={`flex items-center gap-2 rounded-[12px] border px-3 py-2 text-left text-[13px] transition-colors ${adapter === x.name ? 'border-(--action-primary) bg-(--color-primary-50)' : 'border-(--border-subtle) hover:border-(--border-default)'}`}
                >
                  <span className="size-1.5 rounded-full" style={{ background: x.up ? 'var(--status-ok-strong)' : 'var(--ink-4)' }} />
                  <span className="font-medium">{x.name}</span>
                  <span className="tabular-nums text-(--text-muted)">{x.ip}/{x.prefix}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Address</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { value: 'extra' as const, title: 'Its own address', text: 'On 47808 like a real controller, next to a scanner on this PC.' },
                { value: 'own' as const, title: 'This PC’s address', text: `${a?.ip ?? 'Your IP'} on another port. Nothing to add.` },
              ].map((o) => (
                <button
                  key={o.value}
                  onClick={() => setMode(o.value)}
                  className={`rounded-[14px] border p-3 text-left transition-colors ${mode === o.value ? 'border-(--action-primary) bg-(--color-primary-50)' : 'border-(--border-subtle) hover:border-(--border-default)'}`}
                >
                  <div className="text-[13px] font-medium">{o.title}</div>
                  <div className="mt-0.5 text-[12px] text-(--text-muted)">{o.text}</div>
                </button>
              ))}
            </div>

            {mode === 'extra' ? (
              <div className="mt-3">
                <div className="flex items-center gap-2">
                  <Input value={ip} onChange={(e) => setIp(e.target.value)} className="w-44" aria-label="Device address" placeholder="10.0.0.230" />
                  <span className="text-[13px] whitespace-nowrap text-(--text-muted)">: 47808</span>
                  <Button variant="secondary" size="sm" loading={testing} disabled={!ip || !a} onClick={test}>
                    Test
                  </Button>
                </div>
                {check ? (
                  <div className={`mt-2.5 flex items-start gap-2 rounded-[12px] px-3 py-2 text-[12.5px] ${check.state === 'free' ? 'bg-(--status-ok-bg)' : 'bg-(--status-warn-bg)'}`}>
                    {check.state === 'free' ? <CheckIcon className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                    <span>{check.text}</span>
                  </div>
                ) : (
                  <p className="mt-2 text-[12px] text-(--text-muted)">Test checks nothing on the network answers on that address (ARP and ping).</p>
                )}
                {!data?.admin ? (
                  <p className="mt-2 flex items-start gap-1.5 text-[12px] text-(--text-muted)">
                    <Shield className="mt-0.5 size-3.5 shrink-0" />
                    Windows asks for permission to add addresses. Each comes off again when its window closes, is never used for this PC's own traffic, and is gone after a restart anyway.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[13px] tabular-nums text-(--text-muted)">{a?.ip} :</span>
                <Input value={port} onChange={(e) => setPort(e.target.value)} className="w-24" aria-label="UDP port" />
                <span className="text-[12px] text-(--text-muted)">In BACon: Add a device by IP, {a?.ip}:{port}</span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First instance</Label>
              <Input value={instance} onChange={(e) => setInstance(e.target.value)} inputMode="numeric" aria-label="First device instance" />
            </div>
            <div>
              <Label>Name prefix</Label>
              <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} aria-label="Name prefix" />
            </div>
          </div>
          <p className="-mt-2 text-[12px] text-(--text-muted)">
            The first device is {prefix.trim() || 'RC'}-{instance || '2001'}. Open Rasher again, or use Add devices, and the next one takes instance {(Number(instance) || 2001) + 1} and the next free address.
          </p>

          {data?.leftover.length ? (
            <p className="text-[12px] text-(--text-muted)">
              {data.leftover.join(', ')} is still on this PC from an earlier run.{' '}
              <button className="text-(--action-primary) hover:underline" onClick={async () => { for (const x of data.leftover) await api.forget(x); setData(await api.setup()) }}>
                Take it off
              </button>
            </p>
          ) : null}

          {error ? <div className="rounded-[12px] bg-(--status-alarm-bg) px-3 py-2 text-[12.5px]">{error}</div> : null}

          <div className="flex items-center justify-end gap-3 pt-1">
            {mode === 'extra' && check?.state !== 'free' ? <span className="text-[12px] text-(--text-muted)">Test the address first</span> : null}
            <Button size="lg" disabled={!ready} loading={starting} onClick={start}>
              Start the device
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
