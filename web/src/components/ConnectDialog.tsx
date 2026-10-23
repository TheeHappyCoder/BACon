import { useCallback, useEffect, useState } from 'react'
import { api, type NetInterface, type PortCheck, type Status } from '../api'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { SPIN, useSpin } from './spin'

const { ReloadIcon, ChevronDown } = Hugeicons

/** "A", "A and B", "A, B and C" */
function listNames(names: string[]) {
  return names.length < 2 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** States that stop BACon from connecting on this adapter and port. */
const BLOCKING = ['busy', 'no-address', 'down', 'reserved', 'blocked', 'invalid']

/**
 * What the port check means: a word or two for the box beside the input, and the full sentence for the line below.
 * When BACon binds ip:port, Windows hands it everything sent to ip:port; a program on 0.0.0.0:port then only
 * gets broadcasts. The sentences say exactly that, and never guess about programs Windows would not name.
 */
function portStatus(check: PortCheck | null, failed: boolean, ip: string, port: number) {
  const ok = { tone: 'bg-(--surface-card-muted)', dot: 'bg-(--status-ok-strong)', problem: false }
  const bad = { tone: 'bg-(--status-alarm-bg)', dot: 'bg-(--status-alarm-strong)', problem: true }
  const idle = { tone: 'bg-(--surface-card-muted)', dot: 'bg-(--ink-4)', problem: false }
  if (failed) return { ...idle, label: 'Not checked', detail: 'BACon could not check this port. Connecting checks it again.' }
  if (!check) return { ...idle, label: 'Checking…', detail: '' }
  const holders = check.holders ?? []
  const names = listNames([...new Set(holders.map((h) => h.name.replace(/\.exe$/i, '')))])
  const many = new Set(holders.map((h) => h.name)).size > 1
  const where = `${ip}:${port}`
  switch (check.state) {
    case 'ours':
      return {
        ...ok,
        label: 'Connected',
        detail: names ? `${names} also ${many ? 'listen' : 'listens'} on this port and only ${many ? 'hear' : 'hears'} broadcasts while BACon is connected.` : '',
      }
    case 'free':
      return { ...ok, label: 'Ready', detail: '' }
    case 'shared':
      return {
        ...ok,
        label: 'Ready',
        detail: `${names} also ${many ? 'listen' : 'listens'} on this port. Once BACon connects, anything sent to ${where} comes to BACon, so ${many ? 'they' : 'it'} will only hear broadcasts.`,
      }
    case 'busy':
      return { ...bad, label: 'In use', detail: `${names || 'Another program'} is using ${where}. Close it, or pick another port.` }
    case 'reserved':
      return {
        ...bad,
        label: 'Reserved',
        detail: check.range
          ? `Windows reserves UDP ${check.range[0]}–${check.range[1]} (usually for Hyper-V, WSL or Docker), so no program can use ${port}. Pick another port.`
          : `Windows reserves this port, so no program can use it. Pick another port.`,
      }
    case 'blocked':
      return { ...bad, label: 'Blocked', detail: `Windows refused ${where}. A firewall or security product may be blocking it. Pick another port.` }
    case 'down':
      return { ...bad, label: 'Adapter down', detail: 'This adapter is disconnected. Plug in the cable, or pick another adapter.' }
    case 'no-address':
      return { ...bad, label: 'No address', detail: `${ip} is no longer on this PC. Refresh the adapter list and pick again.` }
    default:
      return { ...bad, label: 'Invalid port', detail: 'Use a number from 1 to 65535. BACnet/IP is usually 47808.' }
  }
}

/** Sits beside the port input with the same height and rounding; only ever a word or two, so it never truncates. */
function PortStatus({ status, canRecheck, spinning, onRecheck }: { status: ReturnType<typeof portStatus>; canRecheck: boolean; spinning: boolean; onRecheck: () => void }) {
  return (
    <span className={`flex h-9 shrink-0 items-center gap-2 rounded-[12px] pl-3 text-[13px] font-medium ${status.tone} ${canRecheck ? 'pr-1' : 'pr-3.5'}`} aria-live="polite">
      <span className={`size-[7px] shrink-0 rounded-full ${status.dot}`} />
      {status.label}
      {canRecheck ? (
        <button
          aria-label="Check the port again"
          title="Check again"
          onClick={onRecheck}
          disabled={spinning}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-[8px] text-(--text-muted) transition-colors hover:bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] hover:text-(--text-strong)"
        >
          <ReloadIcon className={`size-3.5 ${spinning ? SPIN : ''}`} />
        </button>
      ) : null}
    </span>
  )
}

export type NetworkSettings = { ip: string; port: number; bbmd: string; low: string; high: string; timeout: string }

const TIMEOUTS = [
  { value: '3', label: '3 s' },
  { value: '5', label: '5 s' },
  { value: '10', label: '10 s' },
]

function Field({ label, optional, children, hint }: { label: string; optional?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12px] text-(--text-muted)">
        {label}
        {optional ? <span className="text-(--text-faint)"> · optional</span> : null}
      </span>
      {children}
      {hint ? <span className="text-[12px] text-(--text-faint)">{hint}</span> : null}
    </label>
  )
}

/** Like YABE's communication channel: pick the adapter and port, press Start. Starting also searches for devices. */
export function ConnectDialog({
  open,
  onOpenChange,
  status,
  interfaces,
  onRefreshInterfaces,
  settings,
  onSettings,
  onStart,
  onDisconnect,
  busy,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: Status
  interfaces: NetInterface[]
  onRefreshInterfaces: () => Promise<unknown> | void
  settings: NetworkSettings
  onSettings: (s: NetworkSettings) => void
  onStart: () => void
  onDisconnect: () => void
  busy: boolean
  error: string
}) {
  const [more, setMore] = useState(!!(settings.bbmd || settings.low || settings.high))
  const [check, setCheck] = useState<PortCheck | null>(null)
  const [checkFailed, setCheckFailed] = useState(false)
  // the refresh buttons spin while they work; background re-checks stay quiet so the status never flickers
  const [checking, spinCheck] = useSpin()
  const [adaptersSpinning, spinAdapters] = useSpin()
  const runCheck = useCallback(async () => {
    if (!settings.ip) return
    try {
      setCheck(await api.portCheck(settings.ip, settings.port || 0))
      setCheckFailed(false)
    } catch {
      setCheckFailed(true)
    }
  }, [settings.ip, settings.port])

  // a new adapter or port starts from "Checking…" (debounced while typing); while open, re-check every few
  // seconds so a program that grabs or lets go of the port shows up without pressing anything
  useEffect(() => {
    if (!open) return
    setCheck(null)
    setCheckFailed(false)
    const first = setTimeout(runCheck, 250)
    const again = setInterval(runCheck, 5000)
    return () => {
      clearTimeout(first)
      clearInterval(again)
    }
  }, [open, runCheck])
  const iface = interfaces.find((i) => i.ip === settings.ip)
  const set = (patch: Partial<NetworkSettings>) => onSettings({ ...settings, ...patch })

  const port = portStatus(check, checkFailed, settings.ip, settings.port)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[460px]" initialFocus={(type) => type === 'keyboard'}>
        <DialogHeader>
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">BACnet/IP network</DialogTitle>
          <p className="m-0 mt-0.5 text-[12px] text-(--text-muted)">Read-only. Start searches for devices.</p>
        </DialogHeader>
        <div className="flex flex-col gap-3 border-y border-(--border-subtle) bg-(--surface-card) px-5 py-4">
          <Field label="Network adapter">
            <div className="flex gap-2">
              <Select value={settings.ip || null} onValueChange={(ip) => set({ ip: ip as string })}>
                <SelectTrigger size="lg" className="flex-1">
                  <SelectValue placeholder="Choose an adapter" />
                </SelectTrigger>
                <SelectPopup>
                  {interfaces.map((i) => (
                    <SelectItem key={i.ip} value={i.ip}>
                      <span className="flex items-center gap-2">
                        <span>{i.name}</span>
                        <span className="text-[12px] text-(--text-muted)">
                          {i.ip}/{i.prefix}
                        </span>
                        {!i.up ? <span className="rounded-full bg-(--surface-track) px-2 text-[11px] text-(--text-muted)">down</span> : null}
                      </span>
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
              <Button aria-label="Refresh adapters" variant="secondary" size="icon" onClick={() => spinAdapters(onRefreshInterfaces)}>
                <ReloadIcon className={adaptersSpinning ? SPIN : ''} />
              </Button>
            </div>
          </Field>
          <Field label="UDP port">
<div className="flex items-center gap-2.5">
            <Input
              size="lg"
              inputMode="numeric"
              className="w-32"
              value={String(settings.port)}
              onChange={(e) => set({ port: Number(e.target.value.replace(/\D/g, '')) || 0 })}
            />
            <PortStatus status={port} canRecheck={(!!check || checkFailed) && check?.state !== 'ours'} spinning={checking} onRecheck={() => spinCheck(runCheck)} />
            </div>
            {port.detail ? <span className={`text-[12px] leading-snug ${port.problem ? 'text-(--text-strong)' : 'text-(--text-muted)'}`}>{port.detail}</span> : null}
          </Field>

          <button className="flex items-center gap-1 self-start text-[12px] text-(--action-primary) hover:underline" onClick={() => setMore((m) => !m)}>
            <ChevronDown className={`size-3.5 transition-transform ${more ? '' : '-rotate-90'}`} />
            More options
          </button>
          {more ? (
            <div className="nc-view-in flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-2">
                <Field label="Instance from" optional>
                  <Input size="lg"  placeholder="0" value={settings.low} onChange={(e) => set({ low: e.target.value.replace(/\D/g, '') })} />
                </Field>
                <Field label="to" optional>
                  <Input size="lg"  placeholder="4194303" value={settings.high} onChange={(e) => set({ high: e.target.value.replace(/\D/g, '') })} />
                </Field>
                <Field label="Wait for replies">
                  <Select value={settings.timeout} onValueChange={(v) => set({ timeout: v as string })} items={TIMEOUTS}>
                    <SelectTrigger size="lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectPopup>
                      {TIMEOUTS.map((t) => (
                        <SelectItem key={t.value} value={t.value}>
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </Field>
              </div>
              <Field label="BBMD" optional hint="For controllers on other subnets.">
                <Input size="lg"  placeholder="10.1.1.1" value={settings.bbmd} onChange={(e) => set({ bbmd: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {error ? <div className="rounded-[12px] bg-(--status-alarm-bg) px-3.5 py-3 text-[12.5px] leading-snug">{error}</div> : null}

        </div>
        <DialogFooter className="justify-between sm:justify-between">
          {status.connected ? (
            <Button variant="ghost" size="sm" onClick={onDisconnect}>
              Disconnect
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={onStart} disabled={!iface || (!!check && BLOCKING.includes(check.state))} loading={busy}>
            {status.connected ? 'Apply and search' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
