import type { ChartSeries } from '@bacon/components/TrendChart'
import type { Control, Running } from '../api'
import { fcu } from './fcu'

export type FaceProps = { s: Running; control: (c: Control) => void; leds: React.ReactNode }
export type Scenario = { title: string; text: string; go: () => void; on?: boolean }
export type Chart = { title: string; unit: string; series: ChartSeries[] }

/**
 * What a kind of equipment brings to the UI; everything else is the same for every device. The shell around a face
 * keeps the name, instance and address, the power switch, Add devices and More in the same place for every type, and
 * hands the face the LEDs to put at the bottom centre of its unit.
 */
export type ProfileUI = {
  /** The middle of the small window: the unit and the controls people use most. Put almost every control here. */
  Face: (p: FaceProps) => React.ReactNode
  /** The left column of the full view: the unit again, and the rest of the controls. */
  Side: (p: FaceProps) => React.ReactNode
  /** Its faults after flaky and slow, as the faults card shows them. */
  faults: Record<string, { title: string; text: string }>
  /** Make something happen, on the alarms view. */
  scenarios: (s: Running, control: (c: Control) => void) => Scenario[]
  /** The trends view, from GET /api/d/{instance}/trend (null until it loads). */
  charts: (data: unknown) => Chart[]
}

export const PROFILES: Record<string, ProfileUI> = { fcu }

/** A type the backend has and this UI doesn't yet: its points and controls are all under More. */
const plain: ProfileUI = {
  Face: ({ s }) => (
    <div className="flex flex-1 items-center justify-center px-8 text-center text-[12.5px] text-(--text-muted)">No face for {s.device.type} yet. Its points and controls are under More.</div>
  ),
  Side: () => null,
  faults: {},
  scenarios: () => [],
  charts: () => [],
}

export const profileOf = (s: Running) => PROFILES[s.device.type] ?? plain
