import { useEffect, useState } from 'react'
import { Button } from '@ui/components/button'
import { Hugeicons } from '@ui/components/hugeicons'
import { Input } from '@ui/components/input'
import { api, type IpCheck, type Network } from '../api'

const { CheckIcon, AlertTriangle, Shield } = Hugeicons

type Mode = Network['mode']

const suggest = (ip: string) => {
  const parts = ip.split('.')
  return parts.length === 4 ? `${parts.slice(0, 3).join('.')}.230` : ''
}

/** "10.0.0.230" + 3 more → "10.0.0.230–233" */
function range(first: string, count: number) {
  const parts = first.split('.')
  const last = Number(parts[3])
  if (parts.length !== 4 || !Number.isInteger(last)) return first
  return count > 1 ? `${first}–${last + count - 1}` : first
}

/** Where every running device sits on the network, and moving them all: addresses of their own on 47808, or this
 *  PC's address on other ports. Values, priority arrays, logs and alarms carry over; only COV subscriptions go. */
export function NetworkSettings({ className = '' }: { className?: string }) {
  const [net, setNet] = useState<Network | null>(null)
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<Mode>('extra')
  const [ip, setIp] = useState('')
  const [port, setPort] = useState('47809')
  const [check, setCheck] = useState<IpCheck | null>(null)
  const [testing, setTesting] = useState(false)
  const [moving, setMoving] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState<string[]>([])

  const load = () => api.network().then(setNet).catch(() => {})
  useEffect(() => {
    load()
    const t = setInterval(load, 5000) // devices come and go from other windows
    return () => clearInterval(t)
  }, [])

  // addresses of their own are what Rasher is for: a controller on the LAN, on 47808; this PC's address is the fallback
  const open = (to: Mode = 'extra') => {
    if (!net) return
    setMode(to)
    setIp(net.ip || (net.adapter ? suggest(net.adapter.ip) : ''))
    setPort(String(net.mode === 'own' && net.port !== 47808 ? net.port : 47809))
    setCheck(null)
    setError('')
    setProblems([])
    setEditing(true)
  }

  const test = async () => {
    if (!net?.adapter) return
    setTesting(true)
    setError('')
    try {
      setCheck(await api.test(ip, net.adapter.name))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setTesting(false)
    }
  }

  const move = async () => {
    setMoving(true)
    setError('')
    try {
      const res = await api.move(mode === 'extra' ? { mode, ip } : { mode, port: Number(port) })
      setProblems(res.problems)
      await load()
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setMoving(false)
    }
  }

  if (!net) return null
  const count = net.devices.length
  const devices = count === 1 ? 'the device' : `all ${count} devices`
  const portOk = /^\d+$/.test(port) && Number(port) >= 1024 && Number(port) <= 65535
  const ready = count > 0 && (mode === 'extra' ? check?.state === 'free' : portOk)

  return (
    <section className={`rounded-[14px] border border-(--border-subtle) ${className}`}>
      <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
        <h3 className="text-[12px] font-medium text-(--text-muted)">Network</h3>
        {editing ? null : (
          <Button size="xs" variant="secondary" onClick={() => open()} disabled={!net.adapter}>
            Change
          </Button>
        )}
      </div>
      <div className="px-3.5 pb-3">
        {!editing ? (
          <>
            <p className="py-1 text-[12.5px]">
              {net.mode === 'extra' ? 'Each device has an address of its own, on 47808 like a real controller.' : `On this PC's address${net.adapter ? ` (${net.adapter.ip})` : ''}, each on a port of its own.`}
            </p>
            <ul className="mt-1">
              {net.devices.map((d) => (
                <li key={d.instance} className="flex items-center gap-2 border-t border-(--border-subtle) py-1.5 text-[12.5px] first:border-t-0">
                  <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
                  <span className="tabular-nums text-(--text-muted)">{d.ip}:{d.port}</span>
                </li>
              ))}
            </ul>
            {problems.length ? (
              <div className="mt-2 flex items-start gap-2 rounded-[12px] bg-(--status-warn-bg) px-3 py-2 text-[12.5px]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                <span>{problems.join(' ')} The others moved.</span>
              </div>
            ) : null}
            {net.mode === 'own' && count ? (
              <div className="mt-2 rounded-[12px] bg-(--status-warn-bg) px-3 py-2.5 text-[12.5px]">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>Not like real controllers: they share this PC's address, so a BMS or scanner won't find them by broadcast on 47808.</span>
                </div>
                <Button size="sm" className="mt-2" onClick={() => open('extra')}>
                  Give them their own addresses
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <div className="space-y-3 pt-1">
            <p className="text-[12.5px]">
              {mode === 'extra'
                ? `Each device takes a free address on ${net.adapter ? `${net.adapter.ip.split('.').slice(0, 3).join('.')}.x` : 'your network'} and answers on 47808, like a controller on the LAN.`
                : `Each device on ${net.adapter?.ip ?? 'this PC'}, on a port of its own. A scanner has to add them by address.`}
            </p>
            {mode === 'extra' ? (
              <div>
                <div className="flex items-center gap-2">
                  <Input
                    value={ip}
                    onChange={(e) => {
                      setIp(e.target.value)
                      setCheck(null)
                    }}
                    className="w-36"
                    aria-label="First address"
                    placeholder="10.0.0.230"
                  />
                  <span className="text-[12.5px] whitespace-nowrap text-(--text-muted)">: 47808</span>
                  <Button variant="secondary" size="sm" loading={testing} disabled={!ip} onClick={test}>
                    Test
                  </Button>
                </div>
                {check ? (
                  <div className={`mt-2 flex items-start gap-2 rounded-[12px] px-3 py-2 text-[12.5px] ${check.state === 'free' ? 'bg-(--status-ok-bg)' : 'bg-(--status-warn-bg)'}`}>
                    {check.state === 'free' ? <CheckIcon className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                    <span>{check.text}</span>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[11.5px] text-(--text-muted)">
                    {count > 1 ? `The first device takes this address and the rest the next free ones up, about ${range(ip, count)}.` : 'Test checks nothing on the network answers there.'}
                  </p>
                )}
                {!net.admin ? (
                  <p className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-(--text-muted)">
                    <Shield className="mt-0.5 size-3.5 shrink-0" />
                    Windows asks once to add the addresses, and once more to take the old ones off.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] tabular-nums text-(--text-muted)">{net.adapter?.ip} :</span>
                <Input value={port} onChange={(e) => setPort(e.target.value)} className="w-24" inputMode="numeric" aria-label="First port" />
                <span className="text-[11.5px] text-(--text-muted)">{count > 1 ? 'and the next free ports up' : ''}</span>
              </div>
            )}

            <button className="text-[11.5px] text-(--action-primary) hover:underline" onClick={() => setMode(mode === 'extra' ? 'own' : 'extra')}>
              {mode === 'extra' ? 'Or use this PC’s address on other ports (no administrator prompt)' : 'Give them addresses of their own on 47808 instead'}
            </button>
            <p className="text-[11.5px] text-(--text-muted)">Values, commands, logs and alarms carry over. COV subscriptions end, as they would when a controller is re-addressed.</p>
            {error ? <div className="rounded-[12px] bg-(--status-alarm-bg) px-3 py-2 text-[12.5px]">{error}</div> : null}
            <div className="flex items-center justify-end gap-2">
              {mode === 'extra' && check?.state !== 'free' ? <span className="text-[11.5px] text-(--text-muted)">Test the address first</span> : null}
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)} disabled={moving}>
                Cancel
              </Button>
              <Button size="sm" disabled={!ready} loading={moving} onClick={move}>
                Move {devices}
              </Button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
