import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Device, type Job, type NetInterface, type ObjectRow, type Status, type TrendGroup, type TrendPoint, type TrendStatus } from './api'
import { ConnectDialog, type NetworkSettings } from './components/ConnectDialog'
import { AppMark, type MarkStatus } from './components/AppMark'
import { UpdateDialog, useUpdates } from './components/Updates'
import { Changes, compareRows, type Baseline } from './components/Changes'
import { FilterField, type Severity } from './components/FilterBar'
import { HealthCheck, runChecks, type SavedCheck } from './components/HealthCheck'
import { evaluate, parse } from './query'
import { NetworkTree } from './components/NetworkTree'
import { ObjectTable, type Sort } from './components/ObjectTable'
import { WritePointsSheet } from './components/WritePointsSheet'
import { ColumnsSheet } from './components/ColumnsSheet'
import { ExportDialog } from './components/ExportDialog'
import { ActivityView } from './components/ActivityView'
import { ControlProvider, useControl } from './components/ControlState'
import { WRITABLE_TYPES } from './control'
import { PropertiesPanel } from './components/PropertiesPanel'
import { NetworkView } from './components/NetworkView'
import { LayoutProvider, Pane, PaneToggle } from './components/Layout'
import { TopBar, type Place } from './components/TopBar'
import { SelectionBar } from './components/SelectionBar'
import { SidePanel } from './components/SidePanel'
import { TrendsView } from './components/TrendsView'
import { TrendTargetDialog } from './components/TrendGroupDialog'
import { SchedulesView } from './components/SchedulesView'
import { AlarmsView } from './components/AlarmsView'
import { isAlarmObject, stateOf, type Live } from './alarms'
import { ToastProvider, useToast } from './components/Toasts'
import { DEFAULT_COLUMNS, SYNTHETIC_COLUMNS, exportColumns, exportCsv, exportXlsx } from './exporters'
import { Button } from './ui/components/button'
import { Hugeicons } from './ui/components/hugeicons'
import { ScrollArea } from './ui/components/scroll-area'
import { Tabs, TabsList, TabsTab } from './ui/components/tabs'
import { TooltipProvider } from './ui/components/tooltip'
import { cn } from './ui/utils'
import { TypePicker } from './components/TypePicker'
import { TRIAGE, passesTriage, triageCounts, type TriageId } from './triage'

const { ChevronRight, Columns3, Download, Cpu, Layers } = Hugeicons

function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })
  useEffect(() => localStorage.setItem(key, JSON.stringify(value)), [key, value])
  return [value, setValue] as const
}

function useClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return now
}

const NONE = new Set<string>()

/** Queries offered under the query bar, each only when its property was read in the scope. */
const EXAMPLES = [
  { prop: 'present-value', text: 'present-value > 25' },
  { prop: 'status-flags', text: 'status-flags has fault' },
  { prop: 'event-state', text: 'event-state != normal' },
]
const TONE = { alarm: 'bg-(--status-alarm-bg)', warn: 'bg-(--status-warn-bg)', info: 'bg-(--status-info-bg)' } as const
/** live refresh: how often, and how many of the rows on screen */
const LIVE_EVERY = 3000
const LIVE_ROWS = 300
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Trend logs and trend-log-multiples: their history can be shown in Trends. */
const isTrendLog = (r: ObjectRow) => r.typeId === 20 || r.typeId === 27

function Workspace() {
  const [writeRows, setWriteRows] = useState<ObjectRow[] | null>(null)
  const control = useControl()
  const toast = useToast()
  const now = useClock()

  const [status, setStatus] = useState<Status>({ connected: false, settings: null, host: '' })
  const [interfaces, setInterfaces] = useState<NetInterface[]>([])
  const [net, setNet] = useStored<NetworkSettings>('bx.network.v2', { ip: '', port: 47808, bbmd: '', low: '', high: '', timeout: '3' })
  const [connectOpen, setConnectOpen] = useState(false)
  // one quiet check against GitHub per launch; the rail shows a dot when a newer release is out, and the ring while
  // it downloads
  const [update, setUpdate] = useUpdates(api)
  const [updateOpen, setUpdateOpen] = useState(false)
  const [connectBusy, setConnectBusy] = useState(false)
  const [connectError, setConnectError] = useState('')
  const [searching, setSearching] = useState(false)

  const [devices, setDevices] = useState<Device[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [rows, setRows] = useState<Record<number, ObjectRow[]>>({})
  const [hidden, setHidden] = useState<Set<number>>(new Set())
  const removalTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  // what the table covers (a device, or every device, and perhaps one object type), and the object open beside it
  const [scope, setScope] = useState<{ device: number | null }>({ device: null })
  // the object types picked in the Types list; none is every type. Kept from device to device.
  const [types, setTypes] = useState<string[]>([])
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [columns, setColumns] = useStored<string[]>('bx.columns.v2', DEFAULT_COLUMNS)
  const [presets, setPresets] = useStored<Record<string, string[]>>('bx.presets', {})
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [savedChecks, setSavedChecks] = useStored<SavedCheck[]>('bx.checks', [])
  const [sort, setSort] = useState<Sort>(null)
  const [includeIdentity, setIncludeIdentity] = useStored('bx.includeIdentity', true)
  const [sheetPerDevice, setSheetPerDevice] = useStored('bx.sheetPerDevice', false)
  const [includeErrors, setIncludeErrors] = useStored('bx.includeErrors', true)
  const [columnsOpen, setColumnsOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [view, setView] = useState<'objects' | 'health' | 'changes'>('objects')
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [booted, setBooted] = useState(false)
  const [place, setPlace] = useState<Place>('objects')
  const [trends, setTrends] = useState<TrendStatus>({ running: false, groups: [], points: [], samples: 0, earliest: 0 })
  // objects waiting to be put in a trend group: the Trend dialog is open for them
  const [trendPick, setTrendPick] = useState<ObjectRow[] | null>(null)
  const [netIssues, setNetIssues] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const siteFileRef = useRef<HTMLInputElement>(null)

  const refreshInterfaces = useCallback(async () => {
    const list = await api.interfaces()
    setInterfaces(list)
    setNet((n) => (list.some((i) => i.ip === n.ip) ? n : { ...n, ip: list.find((i) => i.up)?.ip ?? list[0]?.ip ?? '' }))
  }, [setNet])

  const refreshDevices = useCallback(async () => setDevices(await api.devices()), [])

  useEffect(() => {
    ;(async () => {
      try {
        await refreshInterfaces()
        const s = await api.status()
        setStatus(s)
        const devs = await api.devices()
        setDevices(devs)
        const loaded: Record<number, ObjectRow[]> = {}
        for (const d of devs) if (d.objectCount) loaded[d.instance] = await api.objects(d.instance)
        setRows(loaded)
        setJobs(await api.jobs())
        if (!s.connected) setConnectOpen(true)
      } catch (e) {
        toast(message(e), { kind: 'error' })
      } finally {
        setBooted(true)
      }
    })()
  }, [refreshInterfaces, toast])

  // ---- polling while reads run ----
  const runningKey = jobs.filter((j) => j.state === 'running').map((j) => j.id).join(',')
  useEffect(() => {
    if (!runningKey) return
    let ticks = 0
    const timer = setInterval(async () => {
      try {
        const latest = await api.jobs()
        setJobs(latest)
        ticks++
        const ids = runningKey.split(',')
        const finished = latest.filter((j) => ids.includes(j.id) && j.state !== 'running')
        const stillRunning = latest.filter((j) => j.state === 'running')
        const refresh = new Set([...finished.map((j) => j.device), ...(ticks % 3 === 0 ? stillRunning.map((j) => j.device) : [])])
        for (const inst of refresh) {
          const list = await api.objects(inst)
          setRows((r) => ({ ...r, [inst]: list }))
        }
        if (finished.length || ticks % 3 === 0) await refreshDevices()
        for (const j of finished) {
          const d = devices.find((x) => x.instance === j.device)
          const name = d?.name || `Device ${j.device}`
          if (j.state === 'failed') toast(`${name}: the read stopped. ${j.error}`, { kind: 'error' })
          // a few objects read again after a write report themselves where the write was made
          if (j.state === 'done' && !j.only) toast(`${name} read: ${j.total} objects`)
        }
      } catch (e) {
        toast(message(e), { kind: 'error' })
      }
    }, 700)
    return () => clearInterval(timer)
  }, [runningKey, toast, refreshDevices, devices])

  // ---- trends and the network monitor, for the rail badges and the Trends page ----
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const t = await api.trends()
        if (!stop) setTrends(t)
        if (status.connected) {
          const n = await api.network(60)
          if (!stop) {
            setNetIssues(n.events.filter((e) => e.severity !== 'low').length)
            setCapturing(n.capturing)
          }
        }
      } catch {
        /* next tick */
      }
    }
    load()
    const t = setInterval(load, place !== 'objects' || trends.running || capturing ? 2000 : 8000)
    return () => {
      stop = true
      clearInterval(t)
    }
  }, [place, trends.running, status.connected])

  // trending starts with a group: the dialog asks which one, or names a new one
  const trendable = (list: ObjectRow[]) => list.filter((r) => (r.values['present-value'] !== undefined && r.typeId !== 8) || isTrendLog(r))
  const trendRows = (list: ObjectRow[]) => {
    const points = trendable(list)
    if (!points.length) toast('None of these objects has a present value or a log to trend.', { kind: 'error' })
    else setTrendPick(points)
  }
  const trendedIn = (g: TrendGroup, list: ObjectRow[]) => {
    const keys = new Set(g.pointIds.map((id) => trends.points.find((p) => p.id === id)).filter(Boolean).map((p) => `${p!.device}:${p!.typeId},${p!.instance}`))
    return list.filter((r) => keys.has(r.key)).length
  }
  const afterTrend = (res: TrendStatus & { group: number; added: number[] }) => {
    setTrends(res)
    const g = res.groups.find((x) => x.id === res.group)
    const logs = res.points.filter((p) => res.added.includes(p.id) && p.log).length
    const what = res.added.length ? `Added ${res.added.length} point${res.added.length === 1 ? '' : 's'} to ${g?.name ?? 'the group'}` : `Those points are already in ${g?.name ?? 'the group'}`
    toast(logs ? `${what}. Reading the history from ${logs === 1 ? 'the trend log' : `${logs} trend logs`}…` : what, {
      undo: res.added.length
        ? async () => {
            let t: TrendStatus = res
            for (const id of res.added) t = await api.trendGroupRemove(res.group, id)
            setTrends(t)
          }
        : undefined,
    })
  }

  const showInObjects = (p: TrendPoint) => showRow({ device: p.device, key: `${p.device}:${p.typeId},${p.instance}` })
  const showRow = (r: { device: number; key: string }) => {
    setPlace('objects')
    setView('objects')
    setScope({ device: r.device })
    openObject(r.key)
  }

  /** Read some objects again and resolve once the read has finished (refresh buttons spin until then). */
  const rereadObjects = useCallback(
    async (device: number, objects: [number, number][]) => {
      try {
        const started = await api.read([device], false, objects)
        setJobs(await api.jobs())
        const id = started[0]?.id
        for (let i = 0; id && i < 150; i++) {
          await new Promise((r) => setTimeout(r, 300))
          const job = (await api.jobs()).find((j) => j.id === id)
          if (!job || job.state !== 'running') {
            if (job?.state === 'failed') toast(job.error, { kind: 'error' })
            break
          }
        }
        const list = await api.objects(device)
        setRows((r) => ({ ...r, [device]: list }))
      } catch (e) {
        toast(message(e), { kind: 'error' })
      }
    },
    [toast],
  )

  // ---- alarms: each controller's own alarm list, polled while the Alarms page is open ----
  const [liveAlarmsRaw, setLiveAlarms] = useState<Record<number, Live>>({})
  const liveAlarms = useMemo(() => (status.connected ? liveAlarmsRaw : {}), [status.connected, liveAlarmsRaw]) // offline: the last read is all there is
  const checkAlarms = useCallback(
    async (devs: number[], reread: ObjectRow[]) => {
      const results = await Promise.all(
        devs.map(async (d): Promise<[number, Live]> => {
          try {
            const res = await api.events(d)
            return [d, { at: res.at, source: res.source, events: res.events }]
          } catch (e) {
            return [d, { at: Date.now() / 1000, source: '', events: [], error: message(e) }]
          }
        }),
      )
      setLiveAlarms((l) => ({ ...l, ...Object.fromEntries(results) }))
      const byDevice = new Map<number, [number, number][]>()
      for (const r of reread) byDevice.set(r.device, [...(byDevice.get(r.device) ?? []), [r.typeId, r.instance]])
      await Promise.all([...byDevice].map(([d, objs]) => rereadObjects(d, objs)))
    },
    [rereadObjects],
  )

  // ---- network ----
  const searchDevices = useCallback(async () => {
    setSearching(true)
    try {
      const found = await api.scan(net.low === '' ? undefined : Number(net.low), net.high === '' ? undefined : Number(net.high), Number(net.timeout) || 3)
      await refreshDevices()
      toast(
        found.length ? `Found ${found.length} device${found.length === 1 ? '' : 's'}. Click one to read it.` : 'No devices answered. Try Add a device by IP from the network menu.',
        { kind: found.length ? 'success' : 'error' },
      )
    } catch (e) {
      toast(message(e), { kind: 'error' })
    } finally {
      setSearching(false)
    }
  }, [net.low, net.high, net.timeout, refreshDevices, toast])

  const start = async () => {
    const iface = interfaces.find((i) => i.ip === net.ip)
    if (!iface) return
    setConnectBusy(true)
    setConnectError('')
    try {
      const same = status.connected && status.settings?.ip === net.ip && status.settings?.port === net.port && (status.settings?.bbmd || '') === net.bbmd.trim()
      if (!same) setStatus(await api.connect(iface.ip, iface.prefix, net.port || 47808, net.bbmd.trim()))
      setConnectOpen(false)
      searchDevices()
    } catch (e) {
      setConnectError(message(e))
    } finally {
      setConnectBusy(false)
    }
  }

  const disconnect = async () => {
    try {
      setStatus(await api.disconnect())
      setConnectOpen(false)
      toast('Disconnected. The UDP port is free for other tools.')
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  const addByIp = async (ip: string) => {
    try {
      const d = await api.addDevice(ip)
      await refreshDevices()
      toast(`Found ${d.name || `device ${d.instance}`} at ${d.address}`)
      return true
    } catch (e) {
      toast(message(e), { kind: 'error' })
      return false
    }
  }

  // ---- site files ----
  const saveSite = async () => {
    try {
      const d = new Date()
      const p = (n: number) => String(n).padStart(2, '0')
      const name = `${status.host || 'site'} ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`
      const blob = await api.saveSite(name)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${name}.bxsite`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      toast(`Saved ${name}.bxsite. Open it any time, even without a network.`)
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  const openSite = async (file: File) => {
    try {
      const res = await api.openSite(file)
      await refreshDevices()
      const loaded: Record<number, ObjectRow[]> = {}
      for (const inst of res.loaded) loaded[inst] = await api.objects(inst)
      setRows((r) => ({ ...r, ...loaded }))
      setConnectOpen(false)
      const when = res.savedAt ? new Date(res.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'earlier'
      toast(`Opened ${res.loaded.length} device${res.loaded.length === 1 ? '' : 's'} saved ${when}${res.host ? ` on ${res.host}` : ''}`)
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  // ---- reading ----
  const startRead = useCallback(
    async (instances: number[], retryFailed = false, objects?: [number, number][]) => {
      try {
        if (!instances.length) return
        const started = await api.read(instances, retryFailed, objects)
        if (!started.length && retryFailed) toast('Nothing left to retry.')
        setJobs(await api.jobs())
      } catch (e) {
        toast(message(e), { kind: 'error' })
      }
    },
    [toast],
  )

  const cancelJob = async (id: string) => {
    try {
      await api.cancelJob(id)
      setJobs(await api.jobs())
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  const removeDevice = (inst: number) => {
    const d = devices.find((x) => x.instance === inst)
    setHidden((h) => new Set([...h, inst]))
    if (scope.device === inst) {
      setScope({ device: null })
      setOpenKey(null)
    }
    const timer = setTimeout(async () => {
      removalTimers.current.delete(inst)
      try {
        await api.removeDevice(inst)
        setRows((r) => {
          const next = { ...r }
          delete next[inst]
          return next
        })
        await refreshDevices()
      } catch (e) {
        toast(message(e), { kind: 'error' })
      } finally {
        setHidden((h) => new Set([...h].filter((x) => x !== inst)))
      }
    }, 5000)
    removalTimers.current.set(inst, timer)
    toast(`Removed ${d?.name || `device ${inst}`}`, {
      undo: () => {
        clearTimeout(removalTimers.current.get(inst))
        removalTimers.current.delete(inst)
        setHidden((h) => new Set([...h].filter((x) => x !== inst)))
      },
    })
  }

  // ---- scope: picking a device reads it if it has not been read yet ----
  const isReading = (inst: number) => jobs.some((j) => j.device === inst && j.state === 'running')
  const selectScope = (device: number | null) => {
    if (device !== scope.device) setOpenKey(null)
    setScope({ device })
    if (device !== null && !(rows[device] ?? []).length && !isReading(device) && status.connected) startRead([device])
  }
  const openObject = (key: string) => {
    setOpenKey(key)
    setTimeout(() => document.querySelector(`[data-row-key="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' }), 50)
  }

  // ---- derived ----
  const visibleDevices = useMemo(() => devices.filter((d) => !hidden.has(d.instance)), [devices, hidden])
  const allRows = useMemo(() => visibleDevices.flatMap((d) => rows[d.instance] ?? []), [visibleDevices, rows])
  const alarmCounts = useMemo(() => {
    let active = 0
    let unacked = 0
    for (const r of allRows) {
      if (!isAlarmObject(r)) continue
      const s = stateOf(r, liveAlarms[r.device])
      if (s.severity !== 'normal') active++
      if (s.unacked) unacked++
    }
    return { active, unacked }
  }, [allRows, liveAlarms])
  const scopeDeviceId = scope.device
  const scopeDevice = scopeDeviceId === null ? null : visibleDevices.find((d) => d.instance === scopeDeviceId) ?? null

  // the scope before the type chip: every type on the device (or the network), each with its count
  const deviceRows = useMemo(
    () => (scopeDeviceId === null ? visibleDevices.flatMap((d) => rows[d.instance] ?? []) : rows[scopeDeviceId] ?? []),
    [rows, scopeDeviceId, visibleDevices],
  )
  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of deviceRows) counts.set(r.values['Object type'], (counts.get(r.values['Object type']) ?? 0) + 1)
    return [...counts].sort((a, b) => a[0].localeCompare(b[0]))
  }, [deviceRows])
  // types picked on another device that this one lacks are ignored; none left means every type
  const typeFilter = useMemo(() => {
    const here = types.filter((t) => typeCounts.some(([x]) => x === t))
    return here.length ? here : null
  }, [types, typeCounts])
  const scopeRows = useMemo(() => (typeFilter ? deviceRows.filter((r) => typeFilter.includes(r.values['Object type'])) : deviceRows), [deviceRows, typeFilter])

  const available = useMemo(() => {
    const counts = new Map<string, number>()
    for (const r of scopeRows) {
      for (const k of Object.keys(r.values)) counts.set(k, (counts.get(k) ?? 0) + 1)
      for (const k of Object.keys(r.errors)) if (!counts.has(k)) counts.set(k, 0)
    }
    return [...counts].map(([name, count]) => ({ name, count }))
  }, [scopeRows])
  const filterable = useMemo(() => available.filter((p) => !SYNTHETIC_COLUMNS.includes(p.name)).sort((a, b) => a.name.localeCompare(b.name)), [available])
  const healthIssues = useMemo(() => runChecks(scopeRows, savedChecks).filter((c) => c.hits.length).length, [scopeRows, savedChecks])
  const queryNode = useMemo(() => {
    try {
      return parse(query, available.map((p) => p.name))
    } catch {
      return null // the filter bar shows the error; until it is fixed, nothing is filtered out
    }
  }, [query, available])
  const changeCount = useMemo(() => {
    if (!baseline) return 0
    const then = baseline.rows.filter(
      (r) => (scopeDeviceId === null || r.device === scopeDeviceId) && (!typeFilter || typeFilter.includes(r.values['Object type'])),
    )
    return compareRows(scopeRows, then, false).length
  }, [baseline, scopeRows, scopeDeviceId, typeFilter])

  // the triage chips belong to a scope: another device or type starts with none
  const scopeKey = `${scopeDeviceId}|${typeFilter?.join(',') ?? ''}`
  const [triageState, setTriageState] = useState<{ scope: string; ids: Set<TriageId> }>({ scope: '', ids: new Set() })
  const triage = useMemo(() => (triageState.scope === scopeKey ? triageState.ids : new Set<TriageId>()), [triageState, scopeKey])
  const toggleTriage = (id: TriageId) => {
    const ids = new Set(triage)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    setTriageState({ scope: scopeKey, ids })
  }
  // counted over the scope, not the filtered list, so a chip's number stays put when it is clicked
  const triageCount = useMemo(() => triageCounts(scopeRows), [scopeRows])
  const deviceTriage = useMemo(() => {
    const out: Record<number, { fault: number; alarm: number }> = {}
    for (const d of visibleDevices) {
      const { fault, alarm } = triageCounts(rows[d.instance] ?? [])
      out[d.instance] = { fault, alarm }
    }
    return out
  }, [visibleDevices, rows])
  const narrowing = !!query.trim() || !!search.trim() || triage.size > 0

  /** The table's filter, scope aside: triage chips, then the query, then the search. */
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase()
    const searchCols = ['object-name', 'Object type', 'Instance', ...columns]
    return (r: ObjectRow) => {
      if (triage.size && !passesTriage(r, triage)) return false
      if (queryNode && !evaluate(queryNode, r)) return false
      if (q && !searchCols.some((c) => (r.values[c] ?? r.errors[c] ?? '').toLowerCase().includes(q))) return false
      return true
    }
  }, [triage, queryNode, search, columns])
  // every device shows how many of its objects match, so the tree says where else to look
  const matchCounts = useMemo(() => {
    if (!narrowing) return null
    const out: Record<number, number> = {}
    for (const r of allRows) if (matches(r)) out[r.device] = (out[r.device] ?? 0) + 1
    return out
  }, [narrowing, allRows, matches])

  const filtered = useMemo(() => {
    let list = scopeRows.filter(matches)
    if (sort) {
      const { column, dir } = sort
      list = [...list].sort((a, b) => {
        const av = a.values[column] ?? ''
        const bv = b.values[column] ?? ''
        if (!av !== !bv) return av ? -1 : 1
        return av.localeCompare(bv, undefined, { numeric: true, sensitivity: 'base' }) * dir
      })
    }
    return list
  }, [scopeRows, matches, sort])

  // ---- ticked rows: the bulk actions' subject. They belong to a device (or the network); another starts with none ----
  const tickScope = `${scopeDeviceId}`
  const [tickState, setTickState] = useState<{ scope: string; keys: Set<string> }>({ scope: '', keys: NONE })
  const picked = tickState.scope === tickScope ? tickState.keys : NONE
  const setPicked = (keys: Set<string>) => setTickState({ scope: tickScope, keys })
  const tickAnchor = useRef<string | null>(null)
  const pick = (key: string, { range }: { range: boolean }) => {
    const next = new Set(picked)
    const order = filtered.map((r) => r.key)
    const anchor = tickAnchor.current
    const from = range && anchor ? order.indexOf(anchor) : -1
    const to = order.indexOf(key)
    if (anchor && from >= 0 && to >= 0) {
      // a range takes the anchor's state, as in a file list
      const on = picked.has(anchor)
      for (const k of order.slice(Math.min(from, to), Math.max(from, to) + 1)) {
        if (on) next.add(k)
        else next.delete(k)
      }
    } else {
      if (next.has(key)) next.delete(key)
      else next.add(key)
      tickAnchor.current = key
    }
    setPicked(next)
  }
  const pickAll = (on: boolean) => {
    const shown = new Set(filtered.map((r) => r.key))
    setPicked(on ? new Set([...picked, ...shown]) : new Set([...picked].filter((k) => !shown.has(k))))
  }
  const pickedRows = useMemo(() => (picked.size ? deviceRows.filter((r) => picked.has(r.key)) : []), [picked, deviceRows])
  const pickedHidden = useMemo(() => {
    if (!pickedRows.length) return 0
    const shown = new Set(filtered.map((r) => r.key))
    return pickedRows.filter((r) => !shown.has(r.key)).length
  }, [pickedRows, filtered])

  // ---- live values: present value and flags for the rows on screen, every few seconds ----
  const [flash, setFlash] = useState<Map<string, number>>(() => new Map())
  const [liveAt, setLiveAt] = useState(0)
  const [liveError, setLiveError] = useState('')
  const [docHidden, setDocHidden] = useState(() => document.hidden)
  useEffect(() => {
    const onVisibility = () => setDocHidden(document.hidden)
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])
  const polling = booted && place === 'objects' && view === 'objects' && status.connected && !docHidden
  const liveRef = useRef({ filtered, jobs, rows })
  useEffect(() => {
    liveRef.current = { filtered, jobs, rows }
  })
  useEffect(() => {
    if (!polling) return
    let stop = false
    let busy = false // one request in flight at a time
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const tick = async () => {
      if (busy) return
      const batch = liveRef.current.filtered.slice(0, LIVE_ROWS).filter((r) => r.values['present-value'] !== undefined || r.errors['present-value'] !== undefined)
      const devs = new Set(batch.map((r) => r.device))
      // a read in progress owns the device: its rows are about to be replaced anyway
      if (!batch.length || liveRef.current.jobs.some((j) => j.state === 'running' && devs.has(j.device))) return
      busy = true
      try {
        const res = await api.live(batch)
        if (stop) return
        const changed = new Map<string, { value: string; flags: string | null }>()
        for (const d of devs)
          for (const r of liveRef.current.rows[d] ?? []) {
            const v = res.values[r.key]
            if (!v || v.value === null) continue
            if (v.value !== r.values['present-value'] || (v.flags !== null && v.flags !== r.values['status-flags'])) changed.set(r.key, { value: v.value, flags: v.flags })
          }
        if (changed.size) {
          setRows((prev) => {
            const next = { ...prev }
            for (const d of devs) {
              if (!prev[d]) continue
              next[d] = prev[d].map((r) => {
                const c = changed.get(r.key)
                return c ? { ...r, values: { ...r.values, 'present-value': c.value, ...(c.flags !== null ? { 'status-flags': c.flags } : {}) } } : r
              })
            }
            return next
          })
          const at = Date.now()
          setFlash((f) => new Map([...f, ...[...changed.keys()].map((k) => [k, at] as const)]))
          const t = setTimeout(() => {
            timers.delete(t)
            setFlash((f) => new Map([...f].filter(([, v]) => v !== at)))
          }, 1500)
          timers.add(t)
        }
        setLiveAt(res.at * 1000)
        setLiveError('')
      } catch (e) {
        if (!stop) setLiveError(message(e)) // no toast every 3 s: the Live pill stops pulsing instead
      } finally {
        busy = false
      }
    }
    void tick()
    const timer = setInterval(tick, LIVE_EVERY)
    return () => {
      stop = true
      clearInterval(timer)
      for (const t of timers) clearTimeout(t)
    }
  }, [polling])
  const liveFresh = polling && !liveError && now.getTime() - liveAt < 5000

  const selectedKey = openKey
  const selectedRow = selectedKey ? deviceRows.find((r) => r.key === selectedKey) ?? null : null
  const scopeJob = scopeDevice ? [...jobs].reverse().find((j) => j.device === scopeDevice.instance) : undefined
  const running = jobs.filter((j) => j.state === 'running' && !hidden.has(j.device))
  const loading = scopeDevice ? scopeJob?.state === 'running' : running.length > 0
  const deviceLabel = (inst: number) => {
    const d = devices.find((x) => x.instance === inst)
    return d?.name ? `${d.name} (${inst})` : String(inst)
  }

  const anyProblems = visibleDevices.some((d) => d.failedCount > 0)
  const mark: { status: MarkStatus; text: string } = !status.connected
    ? { status: 'offline', text: 'Not connected to a network' }
    : running.length || searching
      ? { status: 'busy', text: searching ? 'Searching for devices' : `Reading ${running.length} device${running.length === 1 ? '' : 's'}` }
      : anyProblems
        ? { status: 'degraded', text: 'Some objects could not be read' }
        : { status: 'healthy', text: `Connected on ${status.settings?.ip}:${status.settings?.port}` }

  // bulk writes act on the ticked rows; a single point is commanded from the drawer
  const isWritable = (r: ObjectRow) => r.typeId !== 8 && (WRITABLE_TYPES.has(r.typeId) || control.fieldsOf(r).length > 0)
  const writablePicked = pickedRows.filter(isWritable).slice(0, 2000)
  const [exportScope, setExportScope] = useState<'ticked' | 'shown'>('shown')
  const exportRows = exportScope === 'ticked' && pickedRows.length ? pickedRows : filtered
  const openExport = (from: 'ticked' | 'shown') => {
    setExportScope(from)
    setExportOpen(true)
  }
  // after a write, read just those objects again so the table shows what the controller now reports
  const rereadRows = (targets: ObjectRow[]) => {
    for (const device of new Set(targets.map((r) => r.device))) {
      void api.read([device], false, targets.filter((r) => r.device === device).map((r) => [r.typeId, r.instance]))
        .then((next) => setJobs((old) => [...old, ...next])).catch((e) => toast(message(e)))
    }
  }

  const doExport = async (kind: 'csv' | 'xlsx') => {
    try {
      const cols = exportColumns(columns, includeIdentity)
      if (!exportRows.length) throw new Error('No rows match the current filters, so there is nothing to export.')
      if (!cols.length) throw new Error('Choose at least one property to export.')
      const name = kind === 'csv' ? exportCsv(exportRows, cols, includeErrors) : await exportXlsx(exportRows, cols, includeErrors, sheetPerDevice, deviceLabel)
      toast(`Exported ${exportRows.length} rows to ${name}`)
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  const closeDrawer = () => setOpenKey(null)
  const toggleColumn = (name: string) => {
    const previous = columns
    const on = columns.includes(name)
    setColumns(on ? columns.filter((c) => c !== name) : [...columns, name])
    toast(on ? `Removed the "${name}" column` : `Added "${name}" as a column`, { undo: () => setColumns(previous) })
  }

  // ---- keyboard: / to search, arrows to move through rows, Esc to deselect ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const typing = target.closest('input, textarea, [contenteditable=true], [role=dialog], [role=menu], [role=listbox], [role=tree]')
      if (e.key === '/' && !typing) {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing || place !== 'objects') return
      if (e.key === 'Escape') {
        if (picked.size) setPicked(NONE)
        else if (openKey) closeDrawer()
      }
      if (view !== 'objects') return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && filtered.length) {
        e.preventDefault()
        pickAll(true)
      }
      if (e.key === ' ' && selectedKey && filtered.some((r) => r.key === selectedKey)) {
        e.preventDefault()
        pick(selectedKey, { range: e.shiftKey })
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filtered.length) {
        e.preventDefault()
        const i = filtered.findIndex((r) => r.key === selectedKey)
        const next = e.key === 'ArrowDown' ? Math.min(filtered.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1)
        openObject(filtered[next].key)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // what the middle shows when there is no table yet: one sentence and the one thing to do
  const emptyState = !booted ? null : !status.connected ? (
    <Empty
      title="Connect to your BACnet network"
      text="Pick the network adapter your controllers are on. Devices then appear in the tree on the left."
      action={
        <Button size="sm" onClick={() => setConnectOpen(true)}>
          Connect
        </Button>
      }
    />
  ) : searching && !visibleDevices.length ? (
    <Empty title="Searching for devices…" text={`Sending a who-is on ${status.settings?.ip}. Devices appear in the tree as they answer.`} />
  ) : !visibleDevices.length ? (
    <Empty
      title="No devices answered"
      text="Search again, or add a device by its IP address from the network menu in the tree."
      action={
        <Button size="sm" onClick={searchDevices}>
          Search again
        </Button>
      }
    />
  ) : scopeDevice && !loading ? (
    <Empty
      title="Not read yet"
      text="Reading loads every object and every property on this device."
      action={
        <Button size="sm" onClick={() => startRead([scopeDevice.instance])}>
          Read {scopeDevice.name || 'device'}
        </Button>
      }
    />
  ) : !scopeDevice && !loading ? (
    <Empty title="Pick a device on the left to read it" text="Its objects fill this table. Click a row for everything it reports; tick rows to write, trend or export just those." />
  ) : null

  // the scope header: the levels above the scope as crumbs, the scope itself as the title, then what it is
  const scopeName = scopeDevice ? scopeDevice.name || `Device ${scopeDevice.instance}` : ''
  const crumbs: { label: string; go: () => void }[] = []
  if (scopeDevice) crumbs.push({ label: 'All devices', go: () => selectScope(null) })
  const title = !scopeDevice ? 'All devices' : scopeName
  const meta = !scopeDevice
    ? status.connected
      ? `${status.settings?.ip}:${status.settings?.port}`
      : visibleDevices.length
        ? 'Not connected · opened from a file'
        : 'Not connected'
    : [`#${scopeDevice.instance}`, scopeDevice.address, scopeDevice.vendorName, scopeDevice.model].filter(Boolean).join(' · ')
  const examples = EXAMPLES.filter((e) => available.some((p) => p.name === e.prop))

  const viewCount = (n: number, tone?: 'warn' | 'ok') => (
    <span
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[11px] leading-none tabular-nums',
        tone === 'warn' ? 'bg-(--color-ns-yellow) text-(--ink)' : 'bg-(--surface-track) text-(--text-muted)',
      )}
    >
      {n}
    </span>
  )

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-(--surface-page) text-(--text-strong)">
      {writeRows && <WritePointsSheet rows={writeRows} onClose={() => setWriteRows(null)} onWritten={() => { control.refresh(); rereadRows(writeRows) }} />}
      <ColumnsSheet open={columnsOpen} onOpenChange={setColumnsOpen} allRows={allRows} columns={columns} onColumns={setColumns} presets={presets} onPresets={setPresets} />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rowCount={exportRows.length}
        columnCount={exportColumns(columns, includeIdentity).length}
        chosenCount={columns.length}
        includeIdentity={includeIdentity}
        onIncludeIdentity={setIncludeIdentity}
        sheetPerDevice={sheetPerDevice}
        onSheetPerDevice={setSheetPerDevice}
        includeErrors={includeErrors}
        onIncludeErrors={setIncludeErrors}
        onChangeColumns={() => {
          setExportOpen(false)
          setColumnsOpen(true)
        }}
        onExport={doExport}
        scope={pickedRows.length ? { ticked: pickedRows.length, shown: filtered.length, value: exportScope, onChange: setExportScope } : undefined}
      />
      <input
        ref={siteFileRef}
        type="file"
        accept=".bxsite"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) openSite(file)
          e.target.value = ''
        }}
      />
      {trendPick ? (
        <TrendTargetDialog
          count={trendPick.length}
          groups={trends.groups}
          pointsOf={(g) => trendedIn(g, trendPick)}
          onOpenChange={(o) => !o && setTrendPick(null)}
          onAdd={async (g) => {
            try {
              afterTrend(await api.trendGroupAdd(g.id, trendPick))
            } catch (e) {
              toast(message(e), { kind: 'error' })
              throw e
            }
          }}
          onCreate={async (v) => {
            try {
              afterTrend(await api.trendGroupCreate(v.name, v.interval, v.mode, trendPick))
            } catch (e) {
              toast(message(e), { kind: 'error' })
              throw e
            }
          }}
        />
      ) : null}
      <TopBar
        host={status.host}
        status={booted ? mark.status : 'busy'}
        statusText={booted ? mark.text : 'Starting…'}
        connected={status.connected}
        address={status.settings ? `${status.settings.ip}:${status.settings.port}` : ''}
        live={liveFresh}
        place={place}
        onPlace={setPlace}
        recording={trends.running}
        alarms={alarmCounts.active}
        unacked={alarmCounts.unacked}
        issues={netIssues}
        capturing={capturing}
        held={control.log.held.length}
        onNetwork={() => setConnectOpen(true)}
        update={update}
        onUpdates={() => setUpdateOpen(true)}
        onSaveSite={saveSite}
        onOpenSite={() => siteFileRef.current?.click()}
        canSave={visibleDevices.some((d) => d.objectCount)}
      />
      <div className="bx-stage flex min-h-0 flex-1">
      {place === 'trends' ? (
        <TrendsView
          status={status}
          trends={trends}
          onTrends={setTrends}
          onShowInObjects={showInObjects}
          onGoToObjects={() => setPlace('objects')}
          allRows={allRows}
          devices={visibleDevices}
        />
      ) : place === 'schedules' ? (
        <SchedulesView
          status={status}
          rows={allRows}
          devices={visibleDevices}
          onShowInObjects={showRow}
          onReread={(r, also) => rereadObjects(r.device, [[r.typeId, r.instance], ...also])}
          onGoToObjects={() => setPlace('objects')}
        />
      ) : place === 'alarms' ? (
        <AlarmsView
          status={status}
          rows={allRows}
          devices={visibleDevices}
          live={liveAlarms}
          onCheck={checkAlarms}
          onShowInObjects={showRow}
          onReread={(r) => rereadObjects(r.device, [[r.typeId, r.instance]])}
          onGoToObjects={() => setPlace('objects')}
        />
      ) : place === 'activity' ? (
        <ActivityView
          status={status}
          rows={allRows}
          devices={visibleDevices}
          onShowInObjects={showRow}
          onReread={(targets) => rereadRows(targets.map((t) => allRows.find((r) => r.device === t.device && r.typeId === t.typeId && r.instance === t.instance)).filter((r): r is ObjectRow => !!r))}
        />
      ) : place === 'network' ? (
        <NetworkView status={status} devices={visibleDevices} />
      ) : (
      <>
      <Pane side="left">
        <NetworkTree
          status={status}
          devices={visibleDevices}
          jobs={jobs}
          selection={scopeDeviceId === null ? { kind: 'network' } : { kind: 'device', device: scopeDeviceId }}
          onSelect={(s) => selectScope(s.kind === 'network' ? null : s.device)}
          searching={searching}
          onConnect={() => setConnectOpen(true)}
          onSearch={searchDevices}
          onAddByIp={addByIp}
          onRead={(inst, retry) => startRead([inst], retry)}
          onReadAll={() => startRead(visibleDevices.map((d) => d.instance))}
          onCancel={cancelJob}
          onRemove={removeDevice}
          booting={!booted}
          matchCounts={matchCounts}
          deviceTriage={deviceTriage}
          totalObjects={allRows.length}
        />
      </Pane>

      <main className="relative flex min-w-0 flex-1 flex-col">
        <div key={`${scopeDeviceId}`} className="nc-view-in flex min-h-0 flex-1 flex-col">
          {/* the page: where you are, what it is, and the two things you do with all of it */}
          <header className="flex shrink-0 items-center gap-3.5 px-6 pt-5 pb-4">
            <span className="-ml-2.5 -mr-1">
              <PaneToggle side="left" />
            </span>
            {/* who this is: an ink tile, with the device's health as a lime or coral light */}
            <span className="relative inline-flex size-12 shrink-0 items-center justify-center rounded-[14px] bg-(--ink) text-(--color-ns-green) shadow-[0_6px_16px_-8px_rgba(0,0,0,.5),inset_0_1px_0_rgba(255,255,255,.08)] [&_svg]:size-[22px]">
              {scopeDevice ? <Cpu /> : <Layers />}
              <span
                className={cn(
                  'absolute -right-1 -bottom-1 size-3.5 rounded-full border-[2.5px] border-(--surface-card)',
                  !status.connected ? 'bg-(--ink-4)' : (scopeDevice ? deviceTriage[scopeDevice.instance]?.fault || deviceTriage[scopeDevice.instance]?.alarm : anyProblems) ? 'bg-(--status-alarm-strong)' : 'bg-(--color-ns-green)',
                )}
              />
            </span>
            <div className="min-w-0 flex-1">
              <nav aria-label="Breadcrumb" className="flex h-[18px] min-w-0 items-center gap-1 text-[12.5px] whitespace-nowrap text-(--text-faint)">
                {crumbs.length ? (
                  crumbs.map((c, i) => (
                    <span key={i} className="flex min-w-0 items-center gap-1">
                      <button className="truncate transition-colors hover:text-(--text-strong)" onClick={c.go}>
                        {c.label}
                      </button>
                      <ChevronRight className="size-3 shrink-0" />
                    </span>
                  ))
                ) : (
                  <span>Network</span>
                )}
              </nav>
              <h1 className="m-0 mt-0.5 truncate text-[22px] leading-7 font-medium tracking-[-0.02em]">{title}</h1>
              <div className="mt-0.5 truncate text-[12.5px] text-(--text-muted)">{booted ? meta : ' '}</div>
            </div>
            {scopeRows.length > 0 || typeFilter ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setColumnsOpen(true)} disabled={!allRows.length}>
                  <Columns3 />
                  Columns
                  <span className="rounded-full bg-(--surface-track) px-1.5 text-[11px] leading-[18px] tabular-nums text-(--text-muted)">{columns.length}</span>
                </Button>
                <Button size="sm" variant="secondary" disabled={!scopeRows.length} onClick={() => openExport(pickedRows.length ? 'ticked' : 'shown')}>
                  <Download />
                  Export
                </Button>
                {selectedRow ? <PaneToggle side="right" /> : null}
              </div>
            ) : selectedRow ? (
              <span>
                <PaneToggle side="right" />
              </span>
            ) : null}
          </header>

          {deviceRows.length > 0 ? (
            <>
              {/* the query, and the view of what it finds */}
              <div className="flex shrink-0 items-start gap-3 px-6">
                <div className="min-w-0 flex-1">
                  <FilterField
                    ref={searchRef}
                    rows={scopeRows}
                    props={filterable}
                    query={query}
                    onQuery={setQuery}
                    search={search}
                    onSearch={setSearch}
                    matchCount={filtered.length}
                    totalCount={scopeRows.length}
                    forceCount={triage.size > 0}
                    onTrend={() => trendRows(filtered)}
                    onSaveCheck={(name: string, severity: Severity, q: string) => {
                      setSavedChecks((c) => [...c, { id: `${Date.now()}`, name, severity, query: q }])
                      toast(`Saved "${name}". It runs in Health check from now on.`)
                    }}
                  />
                </div>
                <Tabs value={view} onValueChange={(v) => setView(v as typeof view)} className="shrink-0">
                  <TabsList className="h-10">
                    <TabsTab value="objects" className="gap-1.5 px-3">
                      Objects
                    </TabsTab>
                    <TabsTab value="health" className="gap-1.5 px-3">
                      Health
                      {healthIssues ? viewCount(healthIssues, 'warn') : null}
                    </TabsTab>
                    <TabsTab value="changes" className="gap-1.5 px-3">
                      Changes
                      {baseline ? viewCount(changeCount) : null}
                    </TabsTab>
                  </TabsList>
                </Tabs>
              </div>

              {/* what kinds of object there are, and what needs a look */}
              <div className="flex shrink-0 items-center gap-4 px-6 pt-3 pb-3.5">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <TypePicker counts={typeCounts} value={typeFilter ?? []} onChange={setTypes} />
                  {typeFilter && typeFilter.length > 1 ? (
                    <span className="min-w-0 truncate text-[12px] text-(--text-muted)" title={typeFilter.join(', ')}>
                      {typeFilter.join(', ')}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5" aria-label="What needs a look">
                  {narrowing ? (
                    <span className="mr-1 text-[12px] tabular-nums text-(--text-muted)">
                      {filtered.length} of {scopeRows.length} match
                    </span>
                  ) : null}
                  {TRIAGE.some((t) => triageCount[t.id] > 0 || triage.has(t.id)) ? (
                    TRIAGE.filter((t) => triageCount[t.id] > 0 || triage.has(t.id)).map((t) => (
                      <button
                        key={t.id}
                        aria-pressed={triage.has(t.id)}
                        onClick={() => toggleTriage(t.id)}
                        className={cn(
                          'inline-flex h-7 items-center gap-1.5 rounded-full pr-3 pl-2.5 text-[12.5px] transition-[background-color,box-shadow] duration-150 hover:shadow-[inset_0_0_0_1px_var(--border-strong)]',
                          triage.has(t.id) ? 'bg-(--ink) text-(--surface-card)' : TONE[t.tone],
                        )}
                      >
                        <span className="font-medium tabular-nums">{triageCount[t.id]}</span>
                        {t.label}
                      </button>
                    ))
                  ) : narrowing || !examples.length ? (
                    <span className="inline-flex h-7 items-center gap-1.5 px-1 text-[12.5px] text-(--text-muted)">
                      <span className="size-1.5 rounded-full bg-(--status-ok-strong)" />
                      Nothing flagged
                    </span>
                  ) : (
                    <>
                      <span className="inline-flex h-7 items-center gap-1.5 pr-1 text-[12.5px] text-(--text-muted)">
                        <span className="size-1.5 rounded-full bg-(--status-ok-strong)" />
                        Nothing flagged · try
                      </span>
                      {examples.map((e) => (
                        <button key={e.text} onClick={() => setQuery(e.text)} className="h-7 rounded-full bg-(--surface-track) px-3 text-[12.5px] tabular-nums text-(--text-strong) transition-colors hover:bg-(--paper-3)">
                          {e.text}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </>
          ) : null}

          <ScrollArea
            scrollFade
            scrollFadeSides={{ left: false, top: false }}
            clampContentMinWidth={view !== 'objects'}
            className={cn('min-h-0 flex-1', deviceRows.length > 0 && 'border-t border-(--border-subtle)')}
          >
            {view === 'changes' && scopeRows.length > 0 ? (
              <Changes
                rows={scopeRows}
                deviceIds={scopeDeviceId === null ? null : [scopeDeviceId]}
                typeFilter={typeFilter}
                baseline={baseline}
                onBaseline={setBaseline}
                selectedKey={selectedKey}
                onSelect={(r) => setOpenKey(r.key)}
              />
            ) : view === 'health' && scopeRows.length > 0 ? (
              <HealthCheck
                rows={scopeRows}
                selectedKey={selectedKey}
                onSelect={(r) => setOpenKey(r.key)}
                scopeLabel={scopeDevice ? scopeDevice.name || `device ${scopeDevice.instance}` : 'every device'}
                saved={savedChecks}
                onDeleteCheck={(id) => {
                  const previous = savedChecks
                  setSavedChecks((c) => c.filter((x) => x.id !== id))
                  toast('Deleted the check', { undo: () => setSavedChecks(previous) })
                }}
              />
            ) : scopeRows.length > 0 || (loading && scopeDevice) ? (
              filtered.length === 0 && !loading ? (
                <Empty title="No objects match" text="Try a shorter search, or turn off a chip above the table." />
              ) : (
                <div className={picked.size ? 'pb-20' : undefined}>
                  <ObjectTable
                    held={control.heldByKey}
                    flash={flash}
                    rows={filtered}
                    columns={columns}
                    sort={sort}
                    onSort={(c) => setSort((s) => (s?.column !== c ? { column: c, dir: 1 } : s.dir === 1 ? { column: c, dir: -1 } : null))}
                    selectedKey={selectedKey}
                    onSelect={(k) => (k === selectedKey ? closeDrawer() : openObject(k))}
                    picked={picked}
                    onPick={pick}
                    onPickAll={pickAll}
                    showDevice={!scopeDevice && visibleDevices.length > 1}
                    loading={!!loading}
                    onAddColumn={() => setColumnsOpen(true)}
                    onRemoveColumn={(c) => setColumns(columns.filter((x) => x !== c))}
                  />
                </div>
              )
            ) : (
              emptyState
            )}
          </ScrollArea>

          {view === 'objects' ? (
            <SelectionBar
              count={pickedRows.length}
              hidden={pickedHidden}
              writable={writablePicked.length}
              canWrite={status.connected}
              onWrite={() => setWriteRows(writablePicked)}
              onTrend={() => trendRows(pickedRows)}
              onReread={() => {
                rereadRows(pickedRows)
                toast(`Reading ${plural(pickedRows.length, 'object')} again`)
              }}
              onExport={() => openExport('ticked')}
              onClear={() => setPicked(NONE)}
            />
          ) : null}
        </div>
      </main>

      <SidePanel open={!!selectedRow} subjectKey={selectedRow?.key}>
        {selectedRow ? (
          <PropertiesPanel
            subject={selectedRow}
            columns={columns}
            onToggleColumn={toggleColumn}
            onClearSubject={closeDrawer}
            canRead={status.connected}
            onReread={() => startRead([selectedRow.device], false, [[selectedRow.typeId, selectedRow.instance]])}
            onTrend={
              isTrendLog(selectedRow)
                ? async () => {
                    // a log's history is the point: add it if needed, then go to the chart
                    if (!trends.points.some((p) => p.device === selectedRow.device && p.typeId === selectedRow.typeId && p.instance === selectedRow.instance)) trendRows([selectedRow])
                    else setPlace('trends')
                  }
                : selectedRow.values['present-value'] !== undefined && selectedRow.typeId !== 8
                  ? () => trendRows([selectedRow])
                  : undefined
            }
            trendLabel={isTrendLog(selectedRow) ? 'Show history' : undefined}
            trended={!isTrendLog(selectedRow) && trends.points.some((p) => p.device === selectedRow.device && p.typeId === selectedRow.typeId && p.instance === selectedRow.instance)}
            onWritten={() => rereadRows([selectedRow])}
            onOpenSchedules={() => setPlace('schedules')}
          />
        ) : null}
      </SidePanel>
      </>
      )}
      </div>

      <UpdateDialog
        app="BACon"
        tagline="BACnet, on site"
        mark={<AppMark size={30} status="healthy" />}
        api={api}
        open={updateOpen}
        onOpenChange={setUpdateOpen}
        update={update}
        onUpdate={setUpdate}
      />
      <ConnectDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        status={status}
        interfaces={interfaces}
        onRefreshInterfaces={() => refreshInterfaces().catch((e) => toast(message(e), { kind: 'error' }))}
        settings={net}
        onSettings={setNet}
        onStart={start}
        onDisconnect={disconnect}
        busy={connectBusy}
        error={connectError}
      />
    </div>
  )
}

function Empty({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return (
    <div className="nc-view-in mx-auto flex max-w-[380px] flex-col items-center px-5 py-16 text-center">
      <div className="text-[15px] font-medium">{title}</div>
      <div className="mt-1 text-[13px] leading-normal text-(--text-muted)">{text}</div>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

class Boundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex h-screen items-center justify-center bg-(--surface-page) p-6">
        <div className="max-w-[420px] rounded-2xl border border-(--border-subtle) bg-(--surface-card) p-6 text-center shadow-(--shadow-sheet)">
          <div className="text-[15px] font-medium">Something broke on this screen</div>
          <div className="mt-1 text-[13px] text-(--text-muted)">Data already read is kept by the backend. Reload to carry on.</div>
          <div className="mt-3 rounded-[12px] bg-(--surface-card-muted) px-3 py-2 text-left text-[11.5px] break-words text-(--text-muted)">{this.state.error.message}</div>
          <Button size="sm" className="mt-4" onClick={() => location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}

export default function App() {
  return (
    <Boundary>
      <TooltipProvider delay={300}>
        <ToastProvider>
          <LayoutProvider>
            <ControlProvider>
              <Workspace />
            </ControlProvider>
          </LayoutProvider>
        </ToastProvider>
      </TooltipProvider>
    </Boundary>
  )
}
