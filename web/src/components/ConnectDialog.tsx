import { useCallback, useEffect, useState } from 'react'
import { api, type NetInterface, type PortCheck, type Status } from '../api'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { Tooltip, TooltipPopup, TooltipTrigger } from '../ui/components/tooltip'

const { RefreshCw, ChevronDown } = Hugeicons

/** A short pill beside the port: free, shared, or what is holding it. Details sit in the tooltip. */
function PortStatus({ check, checking, onRecheck }: { check: PortCheck | null; checking: boolean; onRecheck: () => void }) {
  const names = check?.holders.map((h) => h.name) ?? []
  let tone = 'bg-(--surface-track)'
  let dot = 'bg-(--ink-4)'
  let label = 'Checking…'
  let detail = ''
  if (!checking && check) {
    const s = check.state
    if (s === 'free' || s === 'ours') [tone, dot, label] = ['bg-(--status-ok-bg)', 'bg-(--status-ok-strong)', s === 'ours' ? 'Connected' : 'Free']
    if (s === 'shared') [tone, dot, label, detail] = ['bg-(--status-warn-bg)', 'bg-(--status-warn-strong)', 'Shared', `Also open in ${names.join(', ')}. Fine for reading; close it if replies go missing.`]
    if (s === 'busy') [tone, dot, label, detail] = ['bg-(--status-alarm-bg)', 'bg-(--status-alarm-strong)', names.length ? `In use by ${names[0]}` : 'In use', 'Close that program, then check again.']
    if (s === 'down') [tone, dot, label, detail] = ['bg-(--status-alarm-bg)', 'bg-(--status-alarm-strong)', 'Adapter down', 'Plug in the cable, or pick another adapter.']
    if (s === 'no-address') [tone, dot, label, detail] = ['bg-(--status-alarm-bg)', 'bg-(--status-alarm-strong)', 'No address', 'Refresh the adapter list and pick again.']
    if (s === 'invalid') [tone, dot, label] = ['bg-(--status-alarm-bg)', 'bg-(--status-alarm-strong)', 'Invalid port']
  }
  const retry = !checking && check && !['free', 'ours'].includes(check.state)
  const pill = (
    <span className={`inline-flex h-7 max-w-[240px] items-center gap-1.5 rounded-full pr-1 pl-2.5 text-[12px] ${tone} ${retry ? '' : 'pr-2.5'}`} aria-live="polite">
      <span className={`size-[7px] shrink-0 rounded-full ${dot}`} />
      <span className="truncate">{label}</span>
      {retry ? (
        <button aria-label="Check the port again" onClick={onRecheck} className="inline-flex size-5 shrink-0 items-center justify-center rounded-full hover:bg-white/60">
          <RefreshCw className="size-3" />
        </button>
      ) : null}
    </span>
  )
  if (!detail) return pill
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{pill}</TooltipTrigger>
      <TooltipPopup side="bottom" className="max-w-[260px]">{detail}</TooltipPopup>
    </Tooltip>
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
  onRefreshInterfaces: () => void
  settings: NetworkSettings
  onSettings: (s: NetworkSettings) => void
  onStart: () => void
  onDisconnect: () => void
  busy: boolean
  error: string
}) {
  const [more, setMore] = useState(!!(settings.bbmd || settings.low || settings.high))
  const [check, setCheck] = useState<PortCheck | null>(null)
  const [checking, setChecking] = useState(false)

  const runCheck = useCallback(async () => {
    if (!settings.ip) return
    setChecking(true)
    try {
      setCheck(await api.portCheck(settings.ip, settings.port || 0))
    } catch {
      setCheck(null)
    } finally {
      setChecking(false)
    }
  }, [settings.ip, settings.port])

  // check whenever the dialog opens or the adapter or port changes (debounced while typing)
  useEffect(() => {
    if (!open) return
    const t = setTimeout(runCheck, 250)
    return () => clearTimeout(t)
  }, [open, runCheck])
  const iface = interfaces.find((i) => i.ip === settings.ip)
  const set = (patch: Partial<NetworkSettings>) => onSettings({ ...settings, ...patch })

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
              <Button aria-label="Refresh adapters" variant="secondary" size="icon" onClick={onRefreshInterfaces}>
                <RefreshCw />
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
            <PortStatus check={check} checking={checking} onRecheck={runCheck} />
            </div>
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
          <Button size="sm" onClick={onStart} disabled={!iface || (!!check && ['busy', 'no-address', 'down', 'invalid'].includes(check.state))} loading={busy}>
            {status.connected ? 'Apply and search' : 'Start'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
