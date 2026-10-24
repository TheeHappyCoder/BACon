import { useEffect, useState } from 'react'
import { Button } from '@ui/components/button'
import { Hugeicons } from '@ui/components/hugeicons'
import { Input } from '@ui/components/input'
import { Switch } from '@ui/components/switch'
import type { Control, Point } from '../api'
import { SHORT, STATE_LABEL, ago, when, who } from '../format'
import { StatusPills } from './Points'

const { XIcon, CheckIcon } = Hugeicons

/** The BACnet names for the priorities people actually use. */
const PRIORITY_NAME: Record<number, string> = {
  1: 'Manual life safety',
  2: 'Automatic life safety',
  5: 'Critical equipment control',
  6: 'Minimum on/off',
  8: 'Manual operator',
  12: 'Schedule (here)',
  16: 'The controller’s loop',
}

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="border-t border-(--border-subtle) px-[18px] py-3.5">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[12px] font-medium text-(--text-muted)">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  )
}

function ValueInput({ p, value, onChange }: { p: Point; value: string; onChange: (v: string) => void }) {
  if (p.states?.length) {
    const binary = p.type.startsWith('binary')
    return (
      <span className="inline-flex h-8 flex-wrap items-center gap-0.5 rounded-full bg-(--surface-track) p-[3px]">
        {p.states.map((s, i) => {
          const v = binary ? (i ? 'active' : 'inactive') : String(i + 1)
          return (
            <button
              key={s}
              onClick={() => onChange(v)}
              className={`h-[26px] rounded-full px-2.5 text-[12px] ${value === v ? 'bg-(--surface-card) font-medium text-(--text-strong) shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-(--text-muted) hover:text-(--text-strong)'}`}
            >
              {s}
            </button>
          )
        })}
      </span>
    )
  }
  return (
    <Input
      size="sm"
      className="w-28"
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={String(p.value ?? '')}
      aria-label="Value to write"
    />
  )
}

const toValue = (p: Point, v: string): number | string => (p.type.startsWith('binary') ? v : Number(v))

export function Inspector({ p, control }: { p: Point; control: (c: Control) => Promise<void> }) {
  const [value, setValue] = useState('')
  const [priority, setPriority] = useState(8)
  useEffect(() => {
    setValue(p.states?.length ? (p.type.startsWith('binary') ? String(p.value) : String(p.value)) : '')
    // a fresh form per point
  }, [p.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const canWriteInput = p.outOfService && ['analog-input', 'binary-input', 'multi-state-input'].includes(p.type)
  const valid = value !== '' && (p.states?.length || !Number.isNaN(Number(value)))

  return (
    <div className="flex min-h-0 flex-col">
      <header className="px-[18px] pt-[18px] pb-3">
        <div className="text-[11.5px] tabular-nums text-(--text-muted)">
          {SHORT[p.type] ?? p.type} {p.instance} · {p.type}
        </div>
        <h2 className="mt-0.5 text-[18px] font-medium tracking-[-0.02em]">{p.name}</h2>
        {p.description ? <p className="mt-1 text-[12.5px] text-(--text-muted)">{p.description}</p> : null}
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-[28px] font-light tracking-[-0.03em] tabular-nums">{p.display || '—'}</span>
        </div>
        <div className="mt-2">
          <StatusPills p={p} />
        </div>
      </header>

      {p.commandable ? (
        <Section title="Command">
          <div className="flex flex-wrap items-center gap-2">
            <ValueInput p={p} value={value} onChange={setValue} />
            <label className="flex items-center gap-1.5 text-[12px] text-(--text-muted)">
              at
              <select
                className="h-8 rounded-full border border-(--border-default) bg-(--surface-input) px-2.5 text-[13px] text-(--text-strong) outline-none"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                aria-label="Priority"
              >
                {Array.from({ length: 16 }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                    {PRIORITY_NAME[n] ? ` · ${PRIORITY_NAME[n]}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" disabled={!valid} onClick={() => control({ action: 'write', key: p.key, value: toValue(p, value), priority })}>
              Write
            </Button>
          </div>
          <ol className="mt-3 overflow-hidden rounded-[12px] border border-(--border-subtle)">
            {(p.priorityArray ?? []).length === 0 ? (
              <li className="px-3 py-2 text-[12.5px] text-(--text-muted)">Every priority is empty.</li>
            ) : null}
            {(p.priorityArray ?? []).map((slot) => (
              <li key={slot.priority} className="flex h-9 items-center gap-2 border-t border-(--border-subtle) px-3 text-[12.5px] first:border-t-0" data-active={slot.priority === p.activePriority || undefined}>
                <span className="w-5 text-right font-medium tabular-nums">{slot.priority}</span>
                <span className="min-w-0 flex-1 truncate text-(--text-muted)">{PRIORITY_NAME[slot.priority] ?? ''}</span>
                <span className="font-medium tabular-nums">{slot.display}</span>
                {slot.priority === p.activePriority ? <CheckIcon className="size-3.5 text-(--action-primary)" aria-label="In control" /> : <span className="size-3.5" />}
                <button
                  aria-label={`Relinquish priority ${slot.priority}`}
                  title="Relinquish"
                  className="inline-flex size-6 items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-track) hover:text-(--text-strong)"
                  onClick={() => control({ action: 'release', key: p.key, priority: slot.priority })}
                >
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
            <li className="flex h-9 items-center gap-2 border-t border-(--border-subtle) bg-(--surface-card-muted) px-3 text-[12.5px]">
              <span className="w-5" />
              <span className="flex-1 text-(--text-muted)">Relinquish default</span>
              <span className="tabular-nums">{p.relinquishDefault}</span>
              <span className="size-3.5" />
              <span className="size-6" />
            </li>
          </ol>
        </Section>
      ) : null}

      {['analog-input', 'binary-input', 'analog-output', 'analog-value', 'binary-value', 'multi-state-value', 'multi-state-output', 'schedule', 'loop'].includes(p.type) ? (
        <Section title="Out of service" aside={<Switch checked={p.outOfService} onCheckedChange={(v) => control({ action: 'oos', key: p.key, value: v })} />}>
          <p className="text-[12.5px] text-(--text-muted)">
            {p.outOfService
              ? canWriteInput
                ? 'The value no longer follows the room. Anyone, a BMS included, can write it now.'
                : 'Marked out of service.'
              : 'The value follows the room. Switch on to take it over and write it by hand or from a BMS.'}
          </p>
          {canWriteInput ? (
            <div className="mt-2.5 flex items-center gap-2">
              <ValueInput p={p} value={value} onChange={setValue} />
              <Button size="sm" variant="secondary" disabled={!valid} onClick={() => control({ action: 'write', key: p.key, value: toValue(p, value), priority: null })}>
                Set value
              </Button>
            </div>
          ) : null}
        </Section>
      ) : null}

      {p.alarm ? (
        <Section title="Alarm">
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12.5px]">
            <span className="text-(--text-muted)">State</span>
            <span className="font-medium">{STATE_LABEL[p.alarm.state] ?? p.alarm.state}</span>
            {p.alarm.limits ? (
              <>
                <span className="text-(--text-muted)">Limits</span>
                <span className="tabular-nums">
                  {p.alarm.limits.enable[0] ? `below ${p.alarm.limits.low} ${p.units}` : ''}
                  {p.alarm.limits.enable[0] && p.alarm.limits.enable[1] ? ' or ' : ''}
                  {p.alarm.limits.enable[1] ? `above ${p.alarm.limits.high} ${p.units}` : ''}
                </span>
              </>
            ) : null}
            {p.alarm.alarmValue ? (
              <>
                <span className="text-(--text-muted)">Alarms when</span>
                <span>{p.states?.[p.alarm.alarmValue === 'active' ? 1 : 0]}</span>
              </>
            ) : null}
            <span className="text-(--text-muted)">Class</span>
            <span>Notification class {p.alarm.nc}</span>
          </div>
          <ol className="mt-3 space-y-1.5">
            {(['To off-normal', 'To fault', 'To normal'] as const).map((label, i) => (
              <li key={label} className="flex items-center gap-2 text-[12.5px]">
                <span className="w-24 text-(--text-muted)">{label}</span>
                <span className="flex-1 tabular-nums">{when(p.alarm!.stamps[i])}</span>
                {p.alarm!.acked[i] ? (
                  <span className="text-[11.5px] text-(--text-muted)">acknowledged</span>
                ) : (
                  <Button size="xs" variant="secondary" onClick={() => control({ action: 'ack', key: p.key, value: ['offnormal', 'fault', 'normal'][i] })}>
                    Acknowledge
                  </Button>
                )}
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      <Section title="Last seen">
        <div className="space-y-1 text-[12.5px] text-(--text-muted)">
          <div>{p.lastRead ? `Read by ${who(p.lastRead.by)} ${ago(p.lastRead.at)}` : 'Nobody has read it yet.'}</div>
          {p.lastWrite ? (
            <div>
              Written by {who(p.lastWrite.by)} {ago(p.lastWrite.at)}: {p.lastWrite.property} → {p.lastWrite.value}
              {p.lastWrite.priority ? ` at priority ${p.lastWrite.priority}` : ''}
            </div>
          ) : null}
        </div>
      </Section>
    </div>
  )
}
