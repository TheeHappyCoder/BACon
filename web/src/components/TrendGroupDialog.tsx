import { useState } from 'react'
import type { TrendGroup } from '../api'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { Hugeicons } from '../ui/components/hugeicons'
import { Input } from '../ui/components/input'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '../ui/components/select'
import { cn } from '../ui/utils'
import { NumberField } from './NumberField'

const { LineChart, Plus, Check } = Hugeicons

export const PRESETS = [5, 10, 30, 60, 300, 900, 1800, 3600]
const UNITS = [
  { value: '1', label: 'seconds' },
  { value: '60', label: 'minutes' },
  { value: '3600', label: 'hours' },
]
const MAX_INTERVAL = 24 * 3600

/** 30 → "30 s", 1800 → "30 min", 5400 → "1 h 30 min" */
export function fmtInterval(sec: number) {
  if (sec < 60) return `${sec} s`
  if (sec < 3600) return Number.isInteger(sec / 60) ? `${sec / 60} min` : `${Math.floor(sec / 60)} min ${sec % 60} s`
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h} h ${m} min` : `${h} h`
}

/** "on change, else every 30 s" / "every 5 min" */
export const howItRecords = (g: Pick<TrendGroup, 'mode' | 'interval'>) => (g.mode === 'auto' ? `on change, else every ${fmtInterval(g.interval)}` : `every ${fmtInterval(g.interval)}`)

function Segmented<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; note: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-2 gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex flex-col items-start gap-0.5 rounded-[12px] px-3 py-2.5 text-left transition-[box-shadow,background-color]',
            value === o.value ? 'bg-(--surface-card) shadow-[0_0_0_1.5px_var(--ink)]' : 'bg-(--surface-track) hover:bg-(--paper-3)',
          )}
        >
          <span className="text-[13px] font-medium">{o.label}</span>
          <span className="text-[11.5px] leading-snug text-(--text-muted)">{o.note}</span>
        </button>
      ))}
    </div>
  )
}

/** How often: the common intervals as chips, or any amount of seconds, minutes or hours up to a day. */
export function IntervalPicker({ value, onChange }: { value: number; onChange: (sec: number) => void }) {
  const unit = value % 3600 === 0 ? 3600 : value % 60 === 0 ? 60 : 1
  const [custom, setCustom] = useState(!PRESETS.includes(value))
  const [amount, setAmount] = useState(String(value / unit))
  const [unitS, setUnit] = useState(String(unit))
  const apply = (a: string, u: string) => {
    const sec = Math.round(Number(a) * Number(u))
    if (sec >= 1) onChange(Math.min(sec, MAX_INTERVAL))
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-4 gap-1">
        {PRESETS.map((sec) => (
          <button
            key={sec}
            type="button"
            aria-pressed={!custom && value === sec}
            onClick={() => {
              const u = sec % 3600 === 0 ? 3600 : sec % 60 === 0 ? 60 : 1
              setCustom(false)
              setAmount(String(sec / u))
              setUnit(String(u))
              onChange(sec)
            }}
            className={cn(
              'h-8 rounded-full text-[12.5px] tabular-nums transition-colors',
              !custom && value === sec ? 'bg-(--ink) font-medium text-(--color-ns-green)' : 'bg-(--surface-track) text-(--text-muted) hover:text-(--text-strong)',
            )}
          >
            {fmtInterval(sec)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => {
            setCustom(true)
            apply(amount, unitS)
          }}
          className={cn('h-8 shrink-0 rounded-full px-3.5 text-[12.5px] transition-colors', custom ? 'bg-(--ink) font-medium text-(--color-ns-green)' : 'bg-(--surface-track) text-(--text-muted) hover:text-(--text-strong)')}
        >
          Other
        </button>
        <NumberField
          size="sm"
          integer
          label="Interval"
          className="h-8 w-[72px]"
          value={amount}
          onChange={(v) => {
            setAmount(v)
            setCustom(true)
            apply(v, unitS)
          }}
        />
        <Select
          value={unitS}
          items={UNITS}
          onValueChange={(v) => {
            setUnit(v as string)
            setCustom(true)
            apply(amount, v as string)
          }}
        >
          <SelectTrigger size="sm" aria-label="Interval unit" className="h-8 min-w-0 flex-1 text-[12.5px]">
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {UNITS.map((u) => (
              <SelectItem key={u.value} value={u.value}>
                {u.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </div>
  )
}

/** The fields a group is made of: its name and how it records. */
function GroupFields({ name, onName, mode, onMode, interval, onInterval, autoFocus }: { name: string; onName: (s: string) => void; mode: 'auto' | 'poll'; onMode: (m: 'auto' | 'poll') => void; interval: number; onInterval: (s: number) => void; autoFocus?: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] text-(--text-muted)">Name</span>
        <Input autoFocus={autoFocus} size="lg" placeholder="e.g. Chiller 1, AHU-2, Level 3 zones" value={name} onChange={(e) => onName(e.target.value)} />
      </label>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-(--text-muted)">How it records</span>
        <Segmented
          label="How it records"
          value={mode}
          onChange={onMode}
          options={[
            { value: 'auto', label: 'On change', note: 'The controller sends each change (COV). Points without COV are read on the timer.' },
            { value: 'poll', label: 'On a timer', note: 'Every point is read on the timer, batched per controller.' },
          ]}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] text-(--text-muted)">{mode === 'auto' ? 'Timer, for points without COV' : 'Read every'}</span>
        <IntervalPicker value={interval} onChange={onInterval} />
      </div>
    </div>
  )
}

/** Make a group, or change one: name, mode and interval. A change applies at once, even while recording. */
export function GroupDialog({
  open,
  onOpenChange,
  group,
  onSave,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** the group to change; none makes a new one */
  group?: TrendGroup
  onSave: (v: { name: string; interval: number; mode: 'auto' | 'poll' }) => Promise<void>
}) {
  const [name, setName] = useState(group?.name ?? '')
  const [mode, setMode] = useState<'auto' | 'poll'>(group?.mode ?? 'auto')
  const [interval, setInterval_] = useState(group?.interval ?? 60)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">{group ? 'Trend settings' : 'New trend group'}</DialogTitle>
          <p className="m-0 mt-0.5 text-[12px] text-(--text-muted)">{group ? 'Changes apply straight away, even while it records.' : 'A group records its points together: one chart, one interval, one start button.'}</p>
        </DialogHeader>
        <form
          id="trend-group"
          className="border-y border-(--border-subtle) bg-(--surface-card) px-5 py-4"
          onSubmit={async (e) => {
            e.preventDefault()
            setBusy(true)
            try {
              await onSave({ name: name.trim(), interval, mode })
              onOpenChange(false)
            } finally {
              setBusy(false)
            }
          }}
        >
          <GroupFields autoFocus name={name} onName={setName} mode={mode} onMode={setMode} interval={interval} onInterval={setInterval_} />
        </form>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" type="submit" form="trend-group" loading={busy} disabled={!name.trim()}>
            {group ? 'Save' : 'Make group'}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

/**
 * Trend some objects: into a group that exists, or a new one named here. A point already in the group is not added
 * twice; a point in another group is shared, not read twice.
 */
export function TrendTargetDialog({
  count,
  groups,
  pointsOf,
  onOpenChange,
  onAdd,
  onCreate,
}: {
  count: number
  groups: TrendGroup[]
  /** how many of the objects each group has already */
  pointsOf: (g: TrendGroup) => number
  onOpenChange: (o: boolean) => void
  onAdd: (group: TrendGroup) => Promise<void>
  onCreate: (v: { name: string; interval: number; mode: 'auto' | 'poll' }) => Promise<void>
}) {
  const [pick, setPick] = useState<number | 'new'>(groups.length ? groups[0].id : 'new')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<'auto' | 'poll'>('auto')
  const [interval, setInterval_] = useState(60)
  const [busy, setBusy] = useState(false)
  const target = groups.find((g) => g.id === pick)
  const submit = async () => {
    setBusy(true)
    try {
      if (pick === 'new') await onCreate({ name: name.trim(), interval, mode })
      else if (target) await onAdd(target)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">
            Trend {count} point{count === 1 ? '' : 's'}
          </DialogTitle>
          <p className="m-0 mt-0.5 text-[12px] text-(--text-muted)">Add them to a trend group, or make one for them.</p>
        </DialogHeader>
        <div className="flex max-h-[60vh] flex-col gap-1.5 overflow-y-auto border-y border-(--border-subtle) bg-(--surface-page) px-4 py-3" role="radiogroup" aria-label="Trend group">
          {groups.map((g) => {
            const have = pointsOf(g)
            const on = pick === g.id
            return (
              <button
                key={g.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPick(g.id)}
                className={cn(
                  'flex items-center gap-3 rounded-[12px] bg-(--surface-card) px-3 py-2.5 text-left transition-shadow',
                  on ? 'shadow-[0_0_0_1.5px_var(--ink)]' : 'shadow-[0_0_0_1px_var(--border-subtle)] hover:shadow-[0_0_0_1px_var(--border-strong)]',
                )}
              >
                <span className={cn('relative flex size-8 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-4', on ? 'bg-(--ink) text-(--color-ns-green)' : 'bg-(--surface-track) text-(--text-muted)')}>
                  <LineChart />
                  {g.running ? <span className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full border-2 border-(--surface-card) bg-(--color-ns-green)" /> : null}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13.5px] font-medium">{g.name}</span>
                  <span className="truncate text-[11.5px] text-(--text-muted)">
                    {g.pointIds.length} point{g.pointIds.length === 1 ? '' : 's'} · {howItRecords(g)}
                    {have ? ` · ${have === count ? 'has them all' : `has ${have}`}` : ''}
                  </span>
                </span>
                {on ? <Check className="size-4 shrink-0" /> : null}
              </button>
            )
          })}
          <div
            className={cn(
              'flex flex-col rounded-[12px] bg-(--surface-card) transition-shadow',
              pick === 'new' ? 'shadow-[0_0_0_1.5px_var(--ink)]' : 'shadow-[0_0_0_1px_var(--border-subtle)] hover:shadow-[0_0_0_1px_var(--border-strong)]',
            )}
          >
            <button type="button" role="radio" aria-checked={pick === 'new'} onClick={() => setPick('new')} className="flex items-center gap-3 px-3 py-2.5 text-left">
              <span className={cn('flex size-8 shrink-0 items-center justify-center rounded-[9px] [&_svg]:size-4', pick === 'new' ? 'bg-(--ink) text-(--color-ns-green)' : 'bg-(--surface-track) text-(--text-muted)')}>
                <Plus />
              </span>
              <span className="text-[13.5px] font-medium">New group</span>
            </button>
            {pick === 'new' ? (
              <div className="nc-view-in border-t border-(--border-divider) px-3 pt-3 pb-3.5">
                <GroupFields autoFocus name={name} onName={setName} mode={mode} onMode={setMode} interval={interval} onInterval={setInterval_} />
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" loading={busy} disabled={pick === 'new' ? !name.trim() : !target || pointsOf(target) === count} onClick={() => void submit()}>
            {pick === 'new' ? 'Make group and add' : `Add to ${target?.name ?? 'group'}`}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
