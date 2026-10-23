import { useEffect, useMemo, useState } from 'react'
import { api, type Device, type NetStatus, type PacketInfo, type Status, type Talker } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { Switch } from '../ui/components/switch'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { cn } from '../ui/utils'
import { SERIES, TrendChart } from './TrendChart'
import { Pane, PaneToggle } from './Layout'
import { useToast } from './Toasts'

const { Download, XIcon, Check, ArrowDown, ArrowUp } = Hugeicons

const SEV: Record<string, string> = { critical: 'bg-(--color-ns-red)', high: 'bg-(--color-ns-yellow)', low: 'bg-(--color-ns-cyan-light)' }

function ago(t: number) {
  const s = Math.max(0, Math.round(Date.now() / 1000 - t))
  if (s < 5) return 'now'
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(t * 1000).toLocaleTimeString()
}
const clock = (t: number) => {
  const d = new Date(t * 1000)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-[14px] border border-(--border-subtle) px-4 py-3">
      <div className="text-[12px] text-(--text-muted)">{label}</div>
      <div className="mt-1 text-[24px] leading-none font-medium tracking-[-0.02em] tabular-nums">{value}</div>
      {note ? <div className="mt-1.5 truncate text-[11.5px] text-(--text-faint)">{note}</div> : null}
    </div>
  )
}

const EMPTY: NetStatus = {
  startedAt: 0, local: '', total: 0, bytes: 0, perMinute: { broadcast: 0, unicast: 0, sent: 0 }, series: [], talkers: [], events: [],
  capturing: false, captured: 0, lastCapture: '',
}

export function NetworkView({ status, devices }: { status: Status; devices: Device[] }) {
  const toast = useToast()
  const [net, setNet] = useState<NetStatus>(EMPTY)
  const [packets, setPackets] = useState<PacketInfo[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'broadcast' | 'problems'>('all')
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (!status.connected) return
    let stop = false
    const load = async () => {
      try {
        const n = await api.network(300)
        if (!stop) setNet(n)
      } catch {
        /* next tick */
      }
    }
    load()
    const t = setInterval(load, 1000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [status.connected])

  useEffect(() => {
    if (!status.connected || paused) return
    let stop = false
    const load = async () => {
      try {
        const p = await api.packets(400, selected ?? '')
        if (!stop) setPackets(p)
      } catch {
        /* next tick */
      }
    }
    load()
    const t = setInterval(load, 1500)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [status.connected, paused, selected])

  const nameOf = useMemo(() => new Map(devices.map((d) => [d.instance, d.name])), [devices])
  const talkerName = (t: Talker) => (t.device !== null ? nameOf.get(t.device) || `Device ${t.device}` : 'Unknown device')
  const sel = net.talkers.find((t) => t.address === selected) ?? null
  const shown = packets.filter((p) => (show === 'broadcast' ? p.broadcast : show === 'problems' ? ['error', 'reject', 'abort'].includes(p.kind) : true))
  const issues = net.events.filter((e) => e.severity !== 'low').length
  const now = Date.now() / 1000

  const capture = async () => {
    try {
      setNet(net.capturing ? await api.captureStop() : await api.captureStart())
      if (net.capturing) toast('Capture stopped. Download it from the panel to open in Wireshark.')
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  const exportLog = () => {
    const quote = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
    const lines = ['Time,Direction,From,To,Broadcast,BVLC,Kind,Service,Note,Bytes']
    for (const p of [...shown].reverse())
      lines.push([new Date(p.t * 1000).toISOString(), p.dir, p.src, p.dst, String(p.broadcast), p.bvlc, p.kind, p.service, p.note, String(p.length)].map(quote).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv' }))
    a.download = `bacnet-packets-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.csv`
    a.click()
  }

  const series = [
    { id: 'bc', name: 'Broadcasts received', color: SERIES[0], points: net.series.map((s) => [s[0], s[1], String(s[1])] as [number, number, string]) },
    { id: 'uc', name: 'Replies received', color: SERIES[1], points: net.series.map((s) => [s[0], s[2], String(s[2])] as [number, number, string]) },
    { id: 'out', name: 'Sent by this PC', color: SERIES[2], points: net.series.map((s) => [s[0], s[3], String(s[3])] as [number, number, string]) },
  ]

  if (!status.connected) {
    return (
      <main className="flex min-w-0 flex-1 items-center justify-center">
        <div className="max-w-[380px] text-center">
          <div className="text-[15px] font-medium">Connect to watch the network</div>
          <div className="mt-1 text-[13px] text-(--text-muted)">The monitor listens on the same adapter and port as the rest of the app.</div>
        </div>
      </main>
    )
  }

  return (
    <>
      <Pane side="left">
      <aside className="flex w-full min-w-0 flex-col border-r border-(--border-subtle)">
        <div className="px-4 pt-[18px] pb-2.5">
          <div className="text-[11px] text-(--text-faint)">BACon</div>
          <div className="text-[16px] font-medium tracking-[-0.01em]">Network</div>
        </div>
        <div className="mx-3 mb-3 flex flex-col gap-2.5 rounded-[14px] border border-(--border-subtle) bg-(--surface-card) p-3 shadow-(--shadow-sheet)">
          <div className="flex items-center gap-2">
            <span className="relative inline-flex size-2">
              {net.capturing ? <span className="nc-ping absolute inset-0 rounded-full bg-(--status-alarm-strong)" /> : null}
              <span className={cn('relative inline-flex size-2 rounded-full', net.capturing ? 'bg-(--status-alarm-strong)' : 'bg-(--ink-4)')} />
            </span>
            <span className="text-[13px] font-medium">{net.capturing ? 'Capturing' : 'Not capturing'}</span>
            {net.capturing ? <span className="ml-auto text-[13px] tabular-nums text-(--text-muted)">{net.captured.toLocaleString()} packets</span> : null}
          </div>
          <Button size="sm" variant={net.capturing ? 'ink' : 'default'} onClick={capture}>
            {net.capturing ? 'Stop capture' : 'Start capture'}
          </Button>
          {net.lastCapture ? (
            <a href="/api/network/capture" className="inline-flex items-center gap-1.5 text-[12.5px] text-(--action-primary) hover:underline">
              <Download className="size-3.5" />
              Download {net.lastCapture}
            </a>
          ) : null}
          <span className="text-[11.5px] leading-snug text-(--text-muted)">Saves every packet as a .pcap that opens in Wireshark with full BACnet decoding.</span>
        </div>

        <div className="px-4 pb-1.5 text-[12px] text-(--text-muted)">Heard on the network</div>
        <ScrollArea scrollFade className="min-h-0 flex-1">
          <div className="flex flex-col gap-px px-2 pb-3">
            {net.talkers.map((t) => {
              const problems = Object.values(t.problems).reduce((a, b) => a + b, 0)
              return (
                <button
                  key={t.address}
                  onClick={() => setSelected((s) => (s === t.address ? null : t.address))}
                  data-active={selected === t.address ? 'true' : undefined}
                  className="flex h-[52px] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] data-[active=true]:bg-(--paper-3)"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium">{talkerName(t)}</span>
                    <span className="mt-0.5 flex items-center gap-1">
                      <span className="truncate rounded-full bg-(--surface-track) px-2 text-[11px] leading-[18px] text-(--text-muted)">{t.address}</span>
                      {problems ? <span className="rounded-full bg-(--status-alarm-bg) px-2 text-[11px] leading-[18px]">{problems} errors</span> : null}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-[13px] font-medium tabular-nums">{t.packets.toLocaleString()}</span>
                    <span className="block text-[11px] text-(--text-muted)">{ago(t.last)}</span>
                  </span>
                </button>
              )
            })}
            {!net.talkers.length ? (
              <div className="mx-1 rounded-[12px] border border-dashed border-(--border-default) px-3 py-4 text-center text-[12px] text-(--text-muted)">
                Listening. Devices appear as soon as they send anything.
              </div>
            ) : null}
          </div>
        </ScrollArea>
      </aside>
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-1.5 pr-3 pl-2 text-[13px] text-(--text-muted)">
          <PaneToggle side="left" />
          <span>Network</span>
          <span className="text-(--ink-4)">›</span>
          <span className="font-medium text-(--text-strong)">{net.local || status.settings?.ip}</span>
          <span className="flex-1" />
          {sel ? <PaneToggle side="right" /> : null}
        </header>
        <div className="flex min-h-0 flex-1 gap-[10px] px-3 pb-3">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
            <div className="flex items-start gap-4 px-[18px] pt-[18px] pb-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">BACnet traffic</h1>
                <div className="mt-1 text-[12px] leading-snug text-(--text-muted)">
                  Every broadcast on UDP {status.settings?.port} and this PC's own requests. Traffic between other devices needs a mirror port on the switch.
                </div>
              </div>
              <Button size="sm" variant="white" onClick={exportLog} disabled={!packets.length}>
                Export log
              </Button>
            </div>
            <ScrollArea scrollFade className="min-h-0 flex-1">
              <div className="flex flex-col gap-3 px-[18px] pb-5">
                <div className="grid grid-cols-4 gap-2 max-[1200px]:grid-cols-2">
                  <Tile label="Packets, last minute" value={(net.perMinute.broadcast + net.perMinute.unicast + net.perMinute.sent).toLocaleString()} note={`${net.total.toLocaleString()} since connecting`} />
                  <Tile label="Broadcasts, last minute" value={net.perMinute.broadcast.toLocaleString()} note="who-is, i-am, cov, time sync" />
                  <Tile label="Devices heard" value={String(net.talkers.length)} />
                  <Tile label="Issues" value={String(issues)} note={issues ? 'see below' : 'nothing serious seen'} />
                </div>

                <div className="rounded-[14px] border border-(--border-subtle) p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[13px] font-medium">Packets per second</span>
                    <span className="flex items-center gap-3 text-[12px] text-(--text-muted)">
                      {series.map((s) => (
                        <span key={s.id} className="flex items-center gap-1.5">
                          <span className="h-[2px] w-3 rounded-full" style={{ background: s.color }} />
                          {s.name}
                        </span>
                      ))}
                    </span>
                  </div>
                  <TrendChart series={series} t0={now - 300} t1={now} height={160} empty="Listening for traffic…" />
                </div>

                <div className="rounded-[14px] border border-(--border-subtle)">
                  <div className="px-4 pt-3 pb-2 text-[13px] font-medium">Issues</div>
                  {net.events.length ? (
                    net.events.slice(0, 50).map((e, i) => (
                      <div key={i} className="flex items-center gap-3 border-t border-(--border-divider) px-4 py-2.5">
                        <span className={cn('shrink-0 rounded-full px-2 py-px text-[11px] lowercase', SEV[e.severity])}>{e.severity}</span>
                        <span className="min-w-0 flex-1 text-[13px]">{e.text}</span>
                        <span className="shrink-0 text-[12px] text-(--text-muted)">{ago(e.t)}</span>
                      </div>
                    ))
                  ) : (
                    <div className="flex items-center gap-3 border-t border-(--border-divider) px-4 py-3">
                      <span className="inline-flex size-7 items-center justify-center rounded-full bg-(--color-ns-green)">
                        <Check className="size-3.5" />
                      </span>
                      <span className="text-[12.5px] text-(--text-muted)">Nothing yet. Watching for duplicate device ids, I-Am storms, Who-Is floods and error replies.</span>
                    </div>
                  )}
                </div>

                <div className="overflow-hidden rounded-[14px] border border-(--border-subtle)">
                  <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-2.5">
                    <span className="mr-1 text-[13px] font-medium">Packets</span>
                    <Tabs value={show} onValueChange={(v) => setShow(v as typeof show)}>
                      <TabsList>
                        <TabsTab value="all">All</TabsTab>
                        <TabsTab value="broadcast">Broadcasts</TabsTab>
                        <TabsTab value="problems">Errors</TabsTab>
                      </TabsList>
                    </Tabs>
                    {sel ? (
                      <span className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-(--surface-track) pr-0.5 pl-2.5 text-[12.5px]">
                        {talkerName(sel)}
                        <button aria-label="Show every device" onClick={() => setSelected(null)} className="inline-flex size-6 items-center justify-center rounded-[6px] text-(--text-muted) hover:bg-(--surface-card)">
                          <XIcon className="size-3" />
                        </button>
                      </span>
                    ) : null}
                    <span className="flex-1" />
                    <label className="flex items-center gap-2 text-[12.5px] text-(--text-muted)">
                      Pause
                      <Switch checked={paused} onCheckedChange={setPaused} />
                    </label>
                  </div>
                  <div className="grid grid-cols-[104px_20px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_86px] gap-3 border-t border-(--border-divider) bg-(--surface-card-muted) px-4 py-1.5 text-[11.5px] text-(--text-muted)">
                    <span>Time</span>
                    <span />
                    <span>From</span>
                    <span>To</span>
                    <span>Service</span>
                    <span>Kind</span>
                  </div>
                  {shown.slice(0, 250).map((p, i) => (
                    <div key={`${p.t}-${i}`} className="grid grid-cols-[104px_20px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)_86px] items-center gap-3 border-t border-(--border-divider) px-4 py-[7px] text-[12.5px]">
                      <span className="tabular-nums text-(--text-muted)">{clock(p.t)}</span>
                      <span className="text-(--text-faint)">{p.dir === 'in' ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" />}</span>
                      <span className="truncate tabular-nums">{p.src}</span>
                      <span className="truncate tabular-nums text-(--text-muted)">{p.broadcast ? 'broadcast' : p.dst}</span>
                      <span className="truncate" title={p.note}>
                        {p.service || p.bvlc}
                        {p.note ? <span className="text-(--text-muted)"> · {p.note}</span> : null}
                      </span>
                      <span>
                        <span
                          className={cn(
                            'rounded-full px-2 py-px text-[11px]',
                            ['error', 'reject', 'abort'].includes(p.kind) ? 'bg-(--status-alarm-bg)' : p.broadcast ? 'bg-(--color-ns-cyan-light)' : 'bg-(--surface-track) text-(--text-muted)',
                          )}
                        >
                          {p.kind}
                        </span>
                      </span>
                    </div>
                  ))}
                  {!shown.length ? <div className="border-t border-(--border-divider) px-4 py-4 text-center text-[12.5px] text-(--text-muted)">No packets match.</div> : null}
                </div>
              </div>
            </ScrollArea>
          </section>

          {sel ? (
            <Pane side="right" gap={10}>
            <aside className="nc-view-in flex w-full min-w-0 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
              <div className="flex items-start gap-3 px-[18px] pt-4 pb-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-(--text-faint)">{sel.address}</div>
                  <div className="mt-0.5 truncate text-[17px] font-medium tracking-[-0.01em]">{talkerName(sel)}</div>
                </div>
                <Button aria-label="Close" variant="secondary" size="icon-xs" onClick={() => setSelected(null)}>
                  <XIcon />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2 px-[18px]">
                {[
                  ['Packets', sel.packets.toLocaleString()],
                  ['Broadcasts', sel.broadcasts.toLocaleString()],
                  ['First heard', ago(sel.first)],
                  ['Last heard', ago(sel.last)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-[12px] border border-(--border-subtle) px-3 py-2.5">
                    <div className="text-[11px] text-(--text-faint)">{k}</div>
                    <div className="mt-0.5 text-[14px] font-medium tabular-nums">{v}</div>
                  </div>
                ))}
              </div>
              <div className="px-[18px] pt-4 pb-1 text-[12px] text-(--text-muted)">Services</div>
              <div className="flex flex-col gap-2 px-[18px] pb-4">
                {sel.services.map(([name, n]) => (
                  <div key={name}>
                    <div className="flex justify-between text-[12.5px]">
                      <span className="truncate">{name}</span>
                      <span className="tabular-nums text-(--text-muted)">{n.toLocaleString()}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-(--surface-track)">
                      <div className="h-full rounded-full bg-(--ink)" style={{ width: `${(n / Math.max(...sel.services.map((s) => s[1]))) * 100}%` }} />
                    </div>
                  </div>
                ))}
                {Object.keys(sel.problems).length ? (
                  <div className="mt-1 rounded-[12px] bg-(--status-alarm-bg) px-3 py-2.5 text-[12.5px]">
                    {Object.entries(sel.problems)
                      .map(([k, v]) => `${v} ${k}${v === 1 ? '' : 's'}`)
                      .join(', ')}{' '}
                    sent back to this PC.
                  </div>
                ) : null}
              </div>
            </aside>
            </Pane>
          ) : null}
        </div>
      </main>
    </>
  )
}
