import { Switch } from '@ui/components/switch'
import type { Control } from '../../api'
import { ClockRow, Panel, Row, Segmented, Stepper } from '../../components/controls'
import type { MeterRunning } from '.'

export function BoardPanel({ s, control }: { s: MeterRunning; control: (c: Control) => void }) {
  const m = s.meter
  const pf = m.pfOverride == null ? 'auto' : m.pfOverride < 0.9 ? 'motors' : 'resistive'
  return (
    <Panel title="The board" aside={<>{m.hz.toFixed(2)} Hz · PF {m.pf.toFixed(2)}</>}>
      <div className="grid grid-cols-3 gap-3 pt-2 pb-2">
        {m.phases.map((p, i) => {
          const lost = p.v < 184
          const reversed = p.kw < -0.05
          return (
            <div key={i} className="min-w-0">
              <div className="flex items-baseline justify-between text-[11.5px]">
                <span className="text-(--text-muted)">L{i + 1}</span>
                <span className="font-medium tabular-nums text-(--text-strong)" style={{ color: reversed ? 'var(--status-warn-strong)' : undefined }}>{p.kw.toFixed(1)} kW</span>
              </div>
              <div className="relative mt-1 h-[6px] overflow-hidden rounded-full bg-(--surface-track)">
                <div className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, (p.a / 160) * 100)}%`, background: lost ? 'transparent' : reversed ? 'var(--status-warn-strong)' : 'var(--ink)' }} />
              </div>
              <div className="mt-1 h-4 truncate text-[11px] tabular-nums" style={{ color: lost ? 'var(--status-alarm-strong)' : 'var(--text-muted)' }}>
                {lost ? 'Lost' : `${Math.round(p.v)} V · ${p.a.toFixed(0)} A`}
              </div>
            </div>
          )
        })}
      </div>

      <Row label="Load" hint={m.autoLoad ? 'Following the office day and the weather' : 'Set by hand'}>
        <label className="flex items-center gap-1.5 text-[12px] text-(--text-muted)">
          Auto
          <Switch size="sm" checked={m.autoLoad} onCheckedChange={(v) => control({ action: 'load', value: v ? null : Math.round(m.load) })} />
        </label>
        <Stepper value={Math.round(m.load)} shown={`${Math.round(m.load)} kW`} step={5} max={200} onChange={(v) => control({ action: 'load', value: v })} />
      </Row>
      <Row label="Power factor" hint={pf === 'auto' ? 'An office mix' : pf === 'motors' ? 'Motors: more current for the same power' : 'Heaters: close to 1'}>
        <Segmented
          value={pf}
          options={[
            { value: 'motors', label: 'Motors' },
            { value: 'auto', label: 'Office' },
            { value: 'resistive', label: 'Heaters' },
          ]}
          onChange={(v) => control({ action: 'pf', value: v === 'auto' ? null : v === 'motors' ? 0.8 : 0.99 })}
        />
      </Row>
      <Row label="Phase L3" hint={s.faults.phase ? 'Lost: the phase failure input alarms' : 'Healthy'}>
        <Switch checked={!s.faults.phase} onCheckedChange={(v) => control({ action: 'fault', name: 'phase', value: !v })} />
      </Row>
      <Row label="CT on L2" hint={s.faults.ct ? 'Fitted backwards: L2 reads negative' : 'Fitted the right way round'}>
        <Segmented
          value={s.faults.ct ? 'reversed' : 'ok'}
          options={[
            { value: 'ok', label: 'Right' },
            { value: 'reversed', label: 'Reversed' },
          ]}
          onChange={(v) => control({ action: 'fault', name: 'ct', value: v === 'reversed' })}
        />
      </Row>
      <ClockRow label="Clock" faster="The load changes faster" speed={m.speed} onChange={(v) => control({ action: 'speed', value: v })} />
    </Panel>
  )
}
