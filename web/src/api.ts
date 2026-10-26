export type ControlPoint = {
  key: string; device: number; typeId: number; instance: number; name: string; token: string; error?: string
  kind: 'analog' | 'binary' | 'multistate'; datatype: string; units: string; labelsComplete: boolean
  choices: { value: number; label: string }[]; current: number; commandable: boolean; slots: (number | null)[] | null
  minimum: number | null; maximum: number | null
  relinquishDefault: number | null
}
export type ControlResult = { key: string; state: string; message: string; current?: number }

/** What a writable property takes (see props.py): the editor to show, and how to read its JSON value. */
export type FieldKind =
  | 'real' | 'unsigned' | 'integer' | 'boolean' | 'string' | 'enumerated' | 'bits' | 'string-array' | 'unsigned-array'
  | 'atomic' | 'weekly' | 'exceptions' | 'date-range' | 'date-list'
export type FieldSpec = { kind: FieldKind; enum?: string; bits?: string[] }
export type Writable = { types: Record<string, Record<string, FieldSpec>>; enums: Record<string, { value: number; label: string }[]>; alarm: string[] }
/** A property reviewed for writing: its live value and the token that lets one write go through. */
export type ControlField = {
  key: string; device: number; typeId: number; instance: number; property: string; name: string; token: string; error?: string
  kind: FieldKind; choices?: { value: number; label: string }[]; bits?: string[]; current: unknown
}
export type FieldResult = { key: string; property: string; state: string; message: string; current?: unknown; before?: unknown; value?: unknown }
/** One entry of BACon's action log: what it asked for, what the property was before, and what it read back. */
export type ControlAction = {
  id: string; at: number; key: string; device: number; typeId: number; instance: number; name: string
  property: string; kind: string; units?: string; choices?: { value: number; label: string }[] | null; bits?: string[] | null
  before: unknown; value: unknown; priority: number | null; release: boolean; slotBefore?: number | null; slotAfter?: number | null
  state: 'sending' | 'verified' | 'rejected' | 'unknown'; message?: string; current?: unknown; transition?: number
}
export type ControlLog = { actions: ControlAction[]; held: ControlAction[] }
export type Target = Pick<ObjectRow, 'device' | 'typeId' | 'instance' | 'key'>
export type NetInterface = { name: string; ip: string; prefix: number; up: boolean }

export type Status = {
  connected: boolean
  settings: { ip: string; prefix: number; port: number; bbmd: string } | null
  host: string
}

export type PortCheck = {
  state: 'free' | 'shared' | 'busy' | 'ours' | 'no-address' | 'down' | 'reserved' | 'blocked' | 'invalid'
  /** other programs on this port (this address or all addresses); null when Windows will not say */
  holders: { name: string; pid: number; address: string }[] | null
  /** for 'reserved': the Windows excluded-port range the port falls in */
  range?: [number, number] | null
}

export type Device = {
  instance: number
  address: string
  vendorId: number | null
  name: string
  vendorName: string
  model: string
  firmware: string
  description: string
  infoError: string
  savedAt: string
  objectCount: number
  failedCount: number
  partialCount: number
}

export type ObjectRow = {
  key: string
  device: number
  typeId: number
  instance: number
  status: 'ok' | 'partial' | 'failed'
  values: Record<string, string>
  errors: Record<string, string>
  /** JSON for schedules, calendars, alarm time stamps and trend-log sources, keyed by property */
  detail?: Record<string, unknown>
}

/** What a controller reports as in alarm or unacknowledged. stamps: to-offnormal, to-fault, to-normal (local ISO). */
export type DeviceEvent = {
  typeId: number
  instance: number
  eventState: string
  acked: boolean[]
  stamps: (string | { time: string } | { sequence: number } | null)[]
  notifyType: string
  enable: boolean[]
  priorities: number[]
}
export type DeviceEvents = { source: 'event-information' | 'alarm-summary'; events: DeviceEvent[]; at: number }

export type Job = {
  id: string
  device: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  done: number
  total: number
  error: string
  retry: boolean
  /** read just some objects again (after a write), not the whole device */
  only?: boolean
}

export type TrendPoint = {
  id: number
  device: number
  typeId: number
  instance: number
  name: string
  deviceName: string
  units: string
  method: 'waiting' | 'cov' | 'poll' | 'error' | 'stopped' | 'log'
  last: string
  lastT: number
  samples: number
  error: string
  note: string
  min: number | null
  max: number | null
  avg: number | null
  /** trend logs: the type of the object logged, and which channel of a trend-log-multiple */
  sourceType: number | null
  channel: number | null
  log?: { state: 'waiting' | 'loading' | 'ready' | 'error' | 'unsupported'; loaded: number; total: number; error: string; interval: number; fetchedAt: number }
}
export type TrendStatus = {
  running: boolean
  startedAt: number
  stoppedAt: number
  interval: number
  /** when the next timed read is due (epoch seconds), 0 when nothing is polled */
  nextRead: number
  mode: 'auto' | 'poll'
  points: TrendPoint[]
  samples: number
  file: string
  /** the oldest sample, including history read from trend logs */
  earliest: number
}
/** [time, avg, min, max, last text] per bucket */
export type Bucket = [number, number | null, number | null, number | null, string]

export type Talker = {
  address: string
  device: number | null
  packets: number
  bytes: number
  broadcasts: number
  first: number
  last: number
  services: [string, number][]
  problems: Record<string, number>
}
export type NetEvent = { t: number; severity: 'critical' | 'high' | 'low'; kind: string; text: string; source: string }
export type NetStatus = {
  startedAt: number
  local: string
  total: number
  bytes: number
  perMinute: { broadcast: number; unicast: number; sent: number }
  series: [number, number, number, number][]
  talkers: Talker[]
  events: NetEvent[]
  capturing: boolean
  captured: number
  captureStartedAt: number
}
export type CaptureFile = { name: string; startedAt: number; endedAt: number; packets: number; bytes: number; live: boolean }

export type PacketInfo = {
  t: number
  dir: 'in' | 'out'
  src: string
  dst: string
  broadcast: boolean
  length: number
  bvlc: string
  kind: string
  service: string
  device: number | null
  note: string
}

export type { UpdateStatus } from './components/Updates'
import type { UpdateStatus } from './components/Updates'

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body && !(body instanceof Blob) ? { 'Content-Type': 'application/json', ...(path.startsWith('/api/control/') ? { 'X-BACon-Control': '1' } : {}) } : undefined,
      body: body instanceof Blob ? body : body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new Error('Lost contact with the BACon backend - is it still running?')
  }
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`
    try {
      const data = await res.json()
      if (typeof data.detail === 'string') message = data.detail
    } catch {
      /* not JSON */
    }
    throw new Error(message)
  }
  return res.json() as Promise<T>
}

export const api = {
  controlPrepare: (targets: ObjectRow[]) => call<ControlPoint[]>('POST', '/api/control/prepare', { targets: targets.map(({ device, typeId, instance, key }) => ({ device, typeId, instance, key })) }),
  controlWrite: (token: string, value: number | null, priority: number | null, release: boolean) => call<ControlResult>('POST', '/api/control/write', { token, value, priority, release }),
  /** review other properties for writing; one entry per target, in order */
  fieldPrepare: (targets: Target[], property: string) =>
    call<ControlField[]>('POST', '/api/control/prepare', { targets: targets.map(({ device, typeId, instance, key }) => ({ device, typeId, instance, key, property })) }),
  fieldWrite: (token: string, value: unknown) => call<FieldResult>('POST', '/api/control/write', { token, value }),
  acknowledge: (target: Target, transition: number) =>
    call<ControlAction>('POST', '/api/control/acknowledge', { target: { device: target.device, typeId: target.typeId, instance: target.instance, key: target.key }, transition }),
  controlLog: (limit = 1000) => call<ControlLog>('GET', `/api/control/actions?limit=${limit}`),
  writable: () => call<Writable>('GET', '/api/control/writable'),
  interfaces: () => call<NetInterface[]>('GET', '/api/interfaces'),
  status: () => call<Status>('GET', '/api/status'),
  portCheck: (ip: string, port: number) => call<PortCheck>('GET', `/api/port-check?ip=${encodeURIComponent(ip)}&port=${port}`),
  connect: (ip: string, prefix: number, port: number, bbmd: string) =>
    call<Status>('POST', '/api/connect', { ip, prefix, port, bbmd: bbmd || null }),
  disconnect: () => call<Status>('POST', '/api/disconnect'),
  scan: (low?: number, high?: number, timeout?: number) => call<Device[]>('POST', '/api/scan', { low, high, timeout }),
  addDevice: (address: string) => call<Device>('POST', '/api/devices/add', { address }),
  devices: () => call<Device[]>('GET', '/api/devices'),
  removeDevice: (instance: number) => call<Device[]>('DELETE', `/api/devices/${instance}`),
  objects: (instance: number) => call<ObjectRow[]>('GET', `/api/devices/${instance}/objects`),
  read: (devices: number[], retryFailed = false, objects?: [number, number][]) =>
    call<Job[]>('POST', '/api/read', { devices, retryFailed, objects }),
  /** present-value and status-flags again for the rows on screen, decoded as a full read stores them */
  live: (targets: Target[]) =>
    call<{ at: number; values: Record<string, { value: string | null; flags: string | null; error: string | null }> }>('POST', '/api/live', {
      targets: targets.map(({ device, typeId, instance, key }) => ({ device, typeId, instance, key })),
    }),
  jobs: () => call<Job[]>('GET', '/api/jobs'),
  cancelJob: (id: string) => call<Job>('POST', `/api/jobs/${id}/cancel`),
  async saveSite(name: string): Promise<Blob> {
    const res = await fetch(`/api/site/save?name=${encodeURIComponent(name)}`)
    if (!res.ok) throw new Error(`Saving the site failed (${res.status})`)
    return res.blob()
  },
  openSite: (file: File) =>
    call<{ loaded: number[]; savedAt: string; host: string }>('POST', '/api/site/open', file),
  trends: () => call<TrendStatus>('GET', '/api/trends'),
  trendAdd: (objects: ObjectRow[]) => call<TrendStatus & { added: number[] }>('POST', '/api/trends/points', { objects }),
  trendSync: (id: number) => call<TrendStatus>('POST', `/api/trends/points/${id}/sync`),
  events: (instance: number) => call<DeviceEvents>('GET', `/api/devices/${instance}/events`),
  trendRemove: (id: number) => call<TrendStatus>('DELETE', `/api/trends/points/${id}`),
  trendStart: (interval: number, mode: string) => call<TrendStatus>('POST', '/api/trends/start', { interval, mode }),
  trendStop: () => call<TrendStatus>('POST', '/api/trends/stop'),
  trendClear: () => call<TrendStatus>('POST', '/api/trends/clear'),
  trendSeries: (ids: number[], since: number, buckets: number) =>
    call<Record<string, Bucket[]>>('GET', `/api/trends/series?ids=${ids.join(',')}&since=${since}&buckets=${buckets}`),
  network: (history = 300) => call<NetStatus>('GET', `/api/network?history=${history}`),
  packets: (limit = 300, address = '') => call<PacketInfo[]>('GET', `/api/network/packets?limit=${limit}&address=${encodeURIComponent(address)}`),
  captureStart: () => call<NetStatus>('POST', '/api/network/capture/start'),
  captureStop: () => call<NetStatus>('POST', '/api/network/capture/stop'),
  captures: () => call<CaptureFile[]>('GET', '/api/network/captures'),
  deleteCapture: (name: string) => call<CaptureFile[]>('DELETE', `/api/network/captures/${encodeURIComponent(name)}`),
  update: (check = false, force = false) => call<UpdateStatus>('GET', `/api/update?check=${check}&force=${force}`),
  updateDownload: () => call<UpdateStatus>('POST', '/api/update/download'),
  updateApply: () => call<{ ok: boolean }>('POST', '/api/update/apply'),
  async exportXlsx(filename: string, sheets: { name: string; columns: string[]; rows: string[][] }[]) {
    const res = await fetch('/api/export/xlsx', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, sheets }),
    })
    if (!res.ok) throw new Error(`Excel export failed (${res.status})`)
    return res.blob()
  },
}
