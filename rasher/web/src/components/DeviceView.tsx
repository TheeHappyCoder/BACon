import { Button } from '@ui/components/button'
import { Switch } from '@ui/components/switch'
import type { Control, Running } from '../api'
import { ago, when } from '../format'
import { NetworkSettings } from './NetworkSettings'
import type { ProfileUI } from '../profiles'

function Card({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="rounded-[14px] border border-(--border-subtle)">
      <div className="flex items-center justify-between px-3.5 pt-3 pb-1">
        <h3 className="text-[12px] font-medium text-(--text-muted)">{title}</h3>
        {aside}
      </div>
      <div className="px-3.5 pb-3">{children}</div>
    </section>
  )
}

function FaultRow({ title, text, children }: { title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-t border-(--border-subtle) py-2.5 first:border-t-0">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{title}</div>
        <div className="text-[12px] text-(--text-muted)">{text}</div>
      </div>
      {children}
    </div>
  )
}

export function DeviceView({ s, control, faults }: { s: Running; control: (c: Control) => void; faults: ProfileUI['faults'] }) {
  const d = s.device
  const f = s.faults
  return (
    <div className="grid grid-cols-2 gap-3 px-[18px] pt-4 pb-6">
      <Card title="Talking to it">
        {s.peers.length === 0 ? (
          <p className="py-2 text-[12.5px] text-(--text-muted)">No one has sent it a request yet.</p>
        ) : (
          <ul>
            {s.peers.map((p) => (
              <li key={p.address} className="flex items-center gap-2 border-t border-(--border-subtle) py-2 text-[12.5px] first:border-t-0">
                <span className="size-1.5 rounded-full" style={{ background: Date.now() / 1000 - p.last < 10 ? 'var(--status-ok-strong)' : 'var(--ink-4)' }} />
                <span className="min-w-0 flex-1 truncate font-medium tabular-nums">{p.address}</span>
                <span className="tabular-nums text-(--text-muted)">{p.requests} requests · {ago(p.last)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="COV subscriptions">
        {s.subscriptions.length === 0 ? (
          <p className="py-2 text-[12.5px] text-(--text-muted)">Nobody is subscribed. A BMS that subscribes gets a notification whenever a value moves.</p>
        ) : (
          <ul>
            {s.subscriptions.map((x) => (
              <li key={`${x.subscriber}-${x.process}-${x.object}`} className="flex items-center gap-2 border-t border-(--border-subtle) py-2 text-[12.5px] first:border-t-0">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{x.name}</span>
                  <span className="text-(--text-muted)"> · {x.subscriber}</span>
                </span>
                <span className="text-(--text-muted)">{x.confirmed ? 'confirmed' : 'unconfirmed'}{x.lifetime ? ` · ${x.lifetime} s` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Faults to test with">
        <p className="pb-1 text-[12px] text-(--text-muted)">To take the device off the network completely, use the power switch at the top.</p>
        <FaultRow title="Flaky link" text="Drops about a third of requests, so tools have to retry.">
          <Switch checked={f.flaky} onCheckedChange={(v) => control({ action: 'fault', name: 'flaky', value: v })} />
        </FaultRow>
        <FaultRow title="Slow replies" text="Waits before answering each request.">
          <span className="inline-flex h-8 items-center rounded-full bg-(--surface-track) p-[3px]">
            {[0, 800, 2500].map((ms) => (
              <button
                key={ms}
                onClick={() => control({ action: 'fault', name: 'slow', value: ms })}
                className={`h-[26px] rounded-full px-2.5 text-[12px] tabular-nums ${f.slow === ms ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-(--text-muted)'}`}
              >
                {ms ? `${ms / 1000} s` : 'Off'}
              </button>
            ))}
          </span>
        </FaultRow>
        {Object.keys(f)
          .filter((k) => k !== 'flaky' && k !== 'slow')
          .map((k) => (
            <FaultRow key={k} title={faults[k]?.title ?? k} text={faults[k]?.text ?? ''}>
              <Switch checked={!!f[k]} onCheckedChange={(v) => control({ action: 'fault', name: k, value: v })} />
            </FaultRow>
          ))}
        <FaultRow title="I-Am storm" text="Ten I-Ams a second for 10 s: what a network monitor should flag.">
          <Button size="xs" variant="secondary" onClick={() => control({ action: 'storm', value: 10 })}>
            Start
          </Button>
        </FaultRow>
      </Card>

      <Card title="Device">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 py-1 text-[12.5px]">
          <dt className="text-(--text-muted)">Address</dt>
          <dd className="tabular-nums">{d.ip}:{d.port}</dd>
          <dt className="text-(--text-muted)">Instance</dt>
          <dd className="tabular-nums">{d.instance}</dd>
          <dt className="text-(--text-muted)">Running since</dt>
          <dd>{when(d.started)}</dd>
          <dt className="text-(--text-muted)">Communication</dt>
          <dd>{d.dcc === 'enable' ? 'Enabled' : `${d.dcc === 'disable' ? 'Disabled' : 'Initiation disabled'} by DeviceCommunicationControl${d.dccUntil ? `, until ${when(d.dccUntil)}` : ''}`}</dd>
          <dt className="text-(--text-muted)">Clock</dt>
          <dd>{d.lastSync ? `Synchronised ${ago(d.lastSync.at)}${Math.abs(d.lastSync.offset) >= 1 ? `, ${d.lastSync.offset > 0 ? '+' : ''}${d.lastSync.offset} s from this PC` : ''}` : 'Never synchronised'}</dd>
        </dl>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="xs" variant="secondary" onClick={() => control({ action: 'iam' })}>
            Send I-Am
          </Button>
          <Button size="xs" variant="secondary" onClick={() => control({ action: 'restart', value: 'warmstart' })}>
            Warm restart
          </Button>
          <Button size="xs" variant="secondary" onClick={() => control({ action: 'restart', value: 'coldstart' })}>
            Cold restart
          </Button>
        </div>
        <p className="mt-2 text-[11.5px] text-(--text-muted)">A cold restart also clears every command in the priority arrays, as a real controller does.</p>
      </Card>

      <NetworkSettings />
    </div>
  )
}
