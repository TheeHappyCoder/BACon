import type { UpdateStatus } from '@bacon/components/Updates'
/** The backend's JSON API (src/rasher/server.py). */

export type Adapter = { name: string; ip: string; prefix: number; up: boolean }
export type Settings = { adapter: string; ip: string; mode: 'extra' | 'own'; instance: number; prefix: string; port: number; type: string }
/** A kind of equipment a device can be (src/rasher/profiles). */
export type ProfileInfo = { type: string; label: string; model: string; prefix: string }
export type Setup = { settings: Settings; adapters: Adapter[]; admin: boolean; leftover: string[]; windowed: boolean; profiles: ProfileInfo[] }
export type DeviceSummary = { instance: number; name: string; type: string; ip: string; port: number; powered: boolean }
export type IpCheck = { state: 'free' | 'taken' | 'yours' | 'invalid'; text: string; mac?: string }

export type Write = { by: string; at: number; property: string; value: string; priority: number | null }
export type Alarm = {
  state: string
  /** to-offnormal, to-fault, to-normal */
  acked: number[]
  stamps: (number | null)[]
  enable: number[]
  nc: number
  limits: { high: number; low: number; enable: number[] } | null
  alarmValue: string | null
}
export type Point = {
  key: string
  type: string
  instance: number
  name: string
  description: string
  value: number | string | boolean | null
  display: string
  units: string
  /** in alarm, fault, overridden, out of service */
  statusFlags: number[] | null
  reliability: string | null
  outOfService: boolean
  commandable: boolean
  writable: boolean
  lastWrite: Write | null
  lastRead: { by: string; at: number } | null
  states?: string[]
  priorityArray?: { priority: number; value: number | string | null; display: string }[]
  activePriority?: number | null
  relinquishDefault?: string
  alarm?: Alarm
  records?: number
}
export type Activity = { id: number; t: number; source: string; service: string; detail: string; kind: 'read' | 'write' | 'cov' | 'alarm' | 'discovery' | 'device' | 'dropped' | 'local'; object: string | null }
/** flaky and slow on every device, then the profile's own, each on or off */
export type Faults = { slow: number; flaky: boolean } & Record<string, boolean | number>
export type Subscription = { object: string; name: string; subscriber: string; process: number; confirmed: boolean; lifetime: number }
export type Peer = { address: string; first: number; last: number; requests: number }
export type DeviceInfo = {
  instance: number
  name: string
  type: string
  ip: string
  port: number
  prefix: number
  started: number
  powered: boolean
  dcc: string
  dccUntil: number | null
  restarting: boolean
  lastSync: { at: number; offset: number; utc: boolean } | null
}
export type State =
  | { running: false; devices: number }
  | {
      running: true
      devices: number
      extraIp: string | null
      device: DeviceInfo
      faults: Faults
      points: Point[]
      subscriptions: Subscription[]
      peers: Peer[]
      activity: Activity[]
    }
export type Running = Extract<State, { running: true }>

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try {
      const body = await res.json()
      if (body.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
    } catch {
      /* not JSON */
    }
    throw new Error(msg)
  }
  return res.json()
}

const post = <T>(path: string, body?: unknown) => call<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })

export type Control =
  | { action: 'power'; value: boolean }
  | { action: 'speed'; value: number }
  | { action: 'fault'; name: string; value: boolean | number }
  | { action: 'storm'; value?: number }
  | { action: 'restart'; value: 'warmstart' | 'coldstart' }
  | { action: 'write'; key: string; value: number | string; priority: number | null }
  | { action: 'release'; key: string; priority: number }
  | { action: 'oos'; key: string; value: boolean }
  | { action: 'ack'; key: string; value?: string }
  | { action: 'iam' }
  // fcu
  | { action: 'offset'; value: number }
  | { action: 'people'; value: number | null }
  | { action: 'window'; value: boolean }
  | { action: 'outside'; value: number | null }
  | { action: 'temp'; value: number }
  // meter
  | { action: 'load'; value: number | null }
  | { action: 'pf'; value: number | null }
  // vav
  | { action: 'pressure'; value: number | null }

export const api = {
  setup: () => call<Setup>('/api/setup'),
  test: (ip: string, adapter: string) => post<IpCheck>('/api/test', { ip, adapter }),
  start: (body: { adapter: string; mode: 'extra' | 'own'; ip: string; port: number; instance: number; prefix: string; type: string }) => post<{ instance: number }>('/api/start', body),
  devices: () => call<DeviceSummary[]>('/api/devices'),
  profiles: () => call<ProfileInfo[]>('/api/profiles'),
  /** count more like the newest device, or count of a type */
  add: (count: number, type?: string) => post<{ instances: number[] }>('/api/devices', type ? { devices: [{ type, count }] } : { count }),
  remove: (instance: number) => call<{ ok: true }>(`/api/devices/${instance}`, { method: 'DELETE' }),
  forget: (ip: string) => post<{ ok: true }>(`/api/forget?ip=${encodeURIComponent(ip)}`),
  state: (instance: number, since: number) => call<State>(`/api/d/${instance}/state?since=${since}`),
  control: (instance: number, c: Control) => post<{ ok: true }>(`/api/d/${instance}/control`, c),
  update: (check = false, force = false) => call<UpdateStatus>(`/api/update?check=${check}&force=${force}`),
  updateDownload: () => post<UpdateStatus>('/api/update/download'),
  updateApply: () => post<{ ok: boolean }>('/api/update/apply'),
}

/** The window around the page, when Rasher runs in its own windows (pywebview); absent in a browser. */
type Bridge = { bind: (instance: number) => Promise<void>; expand: (on: boolean) => Promise<void>; title: (text: string) => Promise<void> }
export const bridge = (): Bridge | null => (window as unknown as { pywebview?: { api?: Bridge } }).pywebview?.api ?? null
