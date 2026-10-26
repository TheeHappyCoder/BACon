import { useEffect, useMemo, useState } from 'react'
import { api, type CaptureFile, type Device, type NetStatus, type PacketInfo, type Status, type Talker } from '../api'
import { Button } from '../ui/components/button'
import { Hugeicons } from '../ui/components/hugeicons'
import { ScrollArea } from '../ui/components/scroll-area'
import { Switch } from '../ui/components/switch'
import { Tabs, TabsList, TabsTab } from '../ui/components/tabs'
import { cn } from '../ui/utils'
import { SERIES, TrendChart } from './TrendChart'
import { Pane, PaneToggle } from './Layout'
import { useToast } from './Toasts'

const { Download, XIcon, Check, ArrowDown, ArrowUp, Trash2 } = Hugeicons

const KEEP_CAPTURES = 10

/** 75 → "1:15", 4000 → "1:06:40" */
function duration(sec: number) {
  const s = Math.max(0, Math.round(sec))
  const p = (n: number) => String(n).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}` : `${Math.floor(s / 60)}:${p(s % 60)}`
}

function size(bytes: number) {
  return bytes < 1024 ? `${bytes} B` : bytes < 1048576 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1048576).toFixed(1)} MB`
}

/** "Today 18:24", "Yesterday 09:02", "21 Oct 14:10" */
function when(t: number) {
  const d = new Date(t * 1000)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000)
  return `${days === 0 ? 'Today' : days === 1 ? 'Yesterday' : d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

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
  capturing: false, captured: 0, captureStartedAt: 0,
}

export function NetworkView({ status, devices }: { status: Status; devices: Device[] }) {
  const toast = useToast()
  const [net, setNet] = useState<NetStatus>(EMPTY)
  const [packets, setPackets] = useState<PacketInfo[]>([])
  // devices the packet log is filtered to: click picks one, Ctrl-click adds or removes, Shift-click picks a range
  const [selected, setSelected] = useState<string[]>([])
  const [anchor, setAnchor] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'broadcast' | 'problems'>('all')
  const [paused, setPaused] = useState(false)
  const [captures, setCaptures] = useState<CaptureFile[]>([])
  const loadCaptures = () => api.captures().then(setCaptures).catch(() => {})

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

  const selectedKey = selected.join(',')

  useEffect(() => {
    loadCaptures()
    if (!net.capturing) return
    const t = setInterval(loadCaptures, 2000)
    return () => clearInterval(t)
  }, [net.capturing])

  useEffect(() => {
    if (!status.connected || paused) return
    let stop = false
    const load = async () => {
      try {
        const p = await api.packets(400, selectedKey)
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
  }, [status.connected, paused, selectedKey])

  const nameOf = useMemo(() => new Map(devices.map((d) => [d.instance, d.name])), [devices])
  const talkerName = (t: Talker) => (t.device !== null ? nameOf.get(t.device) || `Device ${t.device}` : 'Unknown device')
  // the details panel is for one device; a multi-selection only filters the log
  const sel = selected.length === 1 ? (net.talkers.find((t) => t.address === selected[0]) ?? null) : null
  const clearSelection = () => {
    setSelected([])
    setAnchor(null)
  }
  const pick = (e: React.MouseEvent, address: string) => {
    const order = net.talkers.map((t) => t.address)
    if (e.shiftKey && anchor && order.includes(anchor)) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(address)].sort((x, y) => x - y)
      const range = order.slice(a, b + 1)
      setSelected((cur) => (e.ctrlKey || e.metaKey ? [...new Set([...cur, ...range])] : range))
      return
    }
    if (e.ctrlKey || e.metaKey) {
      setSelected((cur) => (cur.includes(address) ? cur.filter((x) => x !== address) : [...cur, address]))
    } else {
      setSelected((cur) => (cur.length === 1 && cur[0] === address ? [] : [address]))
    }
    setAnchor(address)
  }
  const shown = packets.filter((p) => (show === 'broadcast' ? p.broadcast : show === 'problems' ? ['error', 'reject', 'abort'].includes(p.kind) : true))
  const issues = net.events.filter((e) => e.severity !== 'low').length
  const now = Date.now() / 1000

  const capture = async () => {
    try {
      setNet(net.capturing ? await api.captureStop() : await api.captureStart())
      if (net.capturing) toast('Capture saved. Click it under Captures to download it for Wireshark.')
      loadCaptures()
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), { kind: 'error' })
    }
  }

  const removeCapture = async (name: string) => {
    try {
      setCaptures(await api.deleteCapture(name))
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
      <aside className="flex w-full min-w-0 flex-col">
        <div className="flex h-12 shrink-0 flex-col justify-center px-4">
          <div className="text-[16px] font-medium tracking-[-0.01em]">Network</div>
        </div>
        <div className="flex h-6 items-center gap-2 px-4 pb-1.5 text-[12px] text-(--text-muted)">
          <span className="flex-1">Heard on the network</span>
          {selected.length > 1 ? (
            <button onClick={clearSelection} className="text-(--text-muted) hover:text-(--text-strong)">
              {selected.length} selected · Clear
            </button>
          ) : selected.length === 1 ? (
            <span className="text-(--text-faint)">Ctrl-click to add more</span>
          ) : null}
        </div>
        <ScrollArea scrollFade className="min-h-0 flex-1">
          <div className="flex flex-col gap-px px-2 pb-3">
            {net.talkers.map((t) => {
              const problems = Object.values(t.problems).reduce((a, b) => a + b, 0)
              return (
                <button
                  key={t.address}
                  onClick={(e) => pick(e, t.address)}
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  aria-pressed={selected.includes(t.address)}
                  data-active={selected.includes(t.address) ? 'true' : undefined}
                  className="flex h-[52px] items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] data-[active=true]:bg-(--surface-card) data-[active=true]:shadow-[0_0_0_1px_var(--border-subtle),0_2px_6px_-2px_rgba(0,0,0,.08)]"
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

        {/* captures: the newest ten .pcap files, newest first; the running one sits on top with its live count */}
        <div className="flex max-h-[45%] shrink-0 flex-col border-t border-(--border-subtle) pt-2.5">
          <div className="flex h-6 items-center gap-2 px-4 pb-1.5 text-[12px] text-(--text-muted)">
            <span className="flex-1">Captures</span>
            {captures.length ? <span className="text-(--text-faint)">keeps the newest {KEEP_CAPTURES}</span> : null}
          </div>
          <ScrollArea scrollFade className="min-h-0">
            <div className="flex flex-col gap-px px-2 pb-3">
              {captures.map((c) =>
                c.live ? (
                  <div key={c.name} className="flex h-[52px] items-center gap-2.5 rounded-[10px] bg-(--status-alarm-bg)/40 px-2">
                    <span className="relative inline-flex size-2 shrink-0">
                      <span className="nc-ping absolute inset-0 rounded-full bg-(--status-alarm-strong)" />
                      <span className="relative inline-flex size-2 rounded-full bg-(--status-alarm-strong)" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">Capturing…</span>
                      <span className="block truncate text-[11.5px] text-(--text-muted)">started {when(c.startedAt)}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[13px] font-medium tabular-nums">{c.packets.toLocaleString()}</span>
                      <span className="block text-[11px] tabular-nums text-(--text-muted)">{duration(c.endedAt - c.startedAt)}</span>
                    </span>
                  </div>
                ) : (
                  <div key={c.name} className="group/cap relative">
                    <a
                      href={`/api/network/captures/${encodeURIComponent(c.name)}`}
                      download
                      title={`Download ${c.name} for Wireshark`}
                      className="flex h-[52px] items-center gap-2.5 rounded-[10px] px-2 transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_5%,transparent)]"
                    >
                      <Download className="size-4 shrink-0 text-(--text-faint) group-hover/cap:text-(--text-strong)" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium">{when(c.startedAt)}</span>
                        <span className="block truncate text-[11.5px] text-(--text-muted)">
                          {duration(c.endedAt - c.startedAt)} · {size(c.bytes)}
                        </span>
                      </span>
                      <span className="shrink-0 text-right transition-opacity group-hover/cap:opacity-0">
                        <span className="block text-[13px] font-medium tabular-nums">{c.packets.toLocaleString()}</span>
                        <span className="block text-[11px] text-(--text-muted)">packets</span>
                      </span>
                    </a>
                    <Button
                      aria-label={`Delete ${c.name}`}
                      title="Delete"
                      variant="ghost"
                      size="icon-xs"
                      className="absolute top-1/2 right-2 -translate-y-1/2 opacity-0 group-hover/cap:opacity-100 focus-visible:opacity-100"
                      onClick={() => removeCapture(c.name)}
                    >
                      <Trash2 />
                    </Button>
                  </div>
                ),
              )}
              {!captures.length ? (
                <div className="px-2 py-1.5 text-[12.5px] leading-snug text-(--text-faint)">Captures save every packet as a .pcap that opens in Wireshark.</div>
              ) : null}
            </div>
          </ScrollArea>
        </div>
      </aside>
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center border-b border-(--border-subtle) gap-1.5 pr-3 pl-2 text-[13px] text-(--text-muted)">
          <PaneToggle side="left" />
          <span>Network</span>
          <span className="text-(--ink-4)">›</span>
          <span className="font-medium text-(--text-strong)">{net.local || status.settings?.ip}</span>
          <span className="flex-1" />
          {sel ? <PaneToggle side="right" /> : null}
        </header>
        <div className="flex min-h-0 flex-1">
          <section className="flex min-w-0 flex-1 flex-col overflow-hidden bg-(--surface-card)">
            <div className="flex items-start gap-4 px-[18px] pt-[18px] pb-3">
              <div className="min-w-0 flex-1">
                <h1 className="m-0 text-[20px] font-medium tracking-[-0.02em]">BACnet traffic</h1>
                <div className="mt-1 text-[12px] leading-snug text-(--text-muted)">
                  Every broadcast on UDP {status.settings?.port} and this PC's own requests. Traffic between other devices needs a mirror port on the switch.
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button size="sm" variant="white" onClick={exportLog} disabled={!packets.length}>
                  Export log
                </Button>
                {/* idle: one button; capturing: the ink capsule Trends uses while recording */}
                {net.capturing ? (
                  <div className="flex h-9 items-center gap-0.5 rounded-full bg-[#1c1c1f] p-[3px] text-[13px] text-white shadow-(--shadow-sheet)">
                    <span className="flex items-center gap-2 pr-2 pl-3 tabular-nums">
                      <span className="relative inline-flex size-2">
                        <span className="nc-ping absolute inset-0 rounded-full bg-(--status-alarm-strong)" />
                        <span className="relative inline-flex size-2 rounded-full bg-(--status-alarm-strong)" />
                      </span>
                      <span className="font-medium">{duration(Date.now() / 1000 - net.captureStartedAt)}</span>
                      <span className="text-white/50">{net.captured.toLocaleString()} packets</span>
                    </span>
                    <button
                      onClick={capture}
                      className="inline-flex h-full items-center gap-1.5 rounded-full bg-white/10 px-3 font-medium text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/35"
                    >
                      <span className="size-2.5 rounded-[3px] bg-white" />
                      Stop
                    </button>
                  </div>
                ) : (
                  <Button size="sm" onClick={capture} title="Save every packet to a .pcap for Wireshark">
                    <span className="size-3 shrink-0 rounded-full border-2 border-white/80 bg-(--status-alarm-strong)" />
                    Start capture
                  </Button>
                )}
              </div>
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
                    {selected.length ? (
                      <span className="inline-flex h-7 items-center gap-1 rounded-[8px] bg-(--surface-track) pr-0.5 pl-2.5 text-[12.5px]">
                        {sel ? talkerName(sel) : `${selected.length} devices`}
                        <button aria-label="Show every device" onClick={clearSelection} className="inline-flex size-6 items-center justify-center rounded-[6px] text-(--text-muted) hover:bg-(--surface-card)">
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
            <Pane side="right">
            <aside className="nc-view-in flex w-full min-w-0 flex-col overflow-hidden bg-(--surface-card)">
              <div className="flex items-start gap-3 px-[18px] pt-4 pb-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] text-(--text-faint)">{sel.address}</div>
                  <div className="mt-0.5 truncate text-[17px] font-medium tracking-[-0.01em]">{talkerName(sel)}</div>
                </div>
                <Button aria-label="Close" variant="secondary" size="icon-xs" onClick={clearSelection}>
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
