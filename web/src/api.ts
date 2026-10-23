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
}

export type Job = {
  id: string
  device: number
  state: 'running' | 'done' | 'failed' | 'cancelled'
  done: number
  total: number
  error: string
  retry: boolean
}

export type TrendPoint = {
  id: number
  device: number
  typeId: number
  instance: number
  name: string
  deviceName: string
  units: string
  method: 'waiting' | 'cov' | 'poll' | 'error' | 'stopped'
  last: string
  lastT: number
  samples: number
  error: string
  note: string
  min: number | null
  max: number | null
  avg: number | null
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

export type UpdateStatus = {
  current: string
  latest: string
  notes: string
  url: string
  published: string
  available: boolean
  canInstall: boolean
  error: string
  state: 'idle' | 'downloading' | 'ready' | 'failed'
  done: number
  total: number
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers: body && !(body instanceof Blob) ? { 'Content-Type': 'application/json' } : undefined,
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
