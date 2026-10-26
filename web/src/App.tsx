import { Component, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, type Device, type Job, type NetInterface, type ObjectRow, type Status, type TrendPoint, type TrendStatus } from './api'
import { ConnectDialog, type NetworkSettings } from './components/ConnectDialog'
import { AppMark, type MarkStatus } from './components/AppMark'
import { UpdateDialog, useUpdates } from './components/Updates'
import { Changes, compareRows, type Baseline } from './components/Changes'
import { FilterField, type Severity } from './components/FilterBar'
import { HealthCheck, runChecks, type SavedCheck } from './components/HealthCheck'
import { evaluate, parse } from './query'
import { NetworkTree, type Selection } from './components/NetworkTree'
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
import { Rail, type Place } from './components/Rail'
import { TrendsView } from './components/TrendsView'
import { SchedulesView } from './components/SchedulesView'
import { AlarmsView } from './components/AlarmsView'
import { isAlarmObject, stateOf, type Live } from './alarms'
import { ToastProvider, useToast } from './components/Toasts'
import { DEFAULT_COLUMNS, SYNTHETIC_COLUMNS, exportColumns, exportCsv, exportXlsx } from './exporters'
import { Badge } from './ui/components/badge'
import { Button } from './ui/components/button'
import { Hugeicons } from './ui/components/hugeicons'
import { ScrollArea } from './ui/components/scroll-area'
import { Skeleton } from './ui/components/skeleton'
import { Tabs, TabsList, TabsTab } from './ui/components/tabs'
import { TooltipProvider } from './ui/components/tooltip'

const { ArrowRight, Columns3, XIcon, CheckIcon } = Hugeicons

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
  return now.toTimeString().slice(0, 8) // 24-hour HH:MM:SS, as in Novacore's Live pill
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** Trend logs and trend-log-multiples: their history can be shown in Trends. */
const isTrendLog = (r: ObjectRow) => r.typeId === 20 || r.typeId === 27

function Workspace() {
  const [writeRows, setWriteRows] = useState<ObjectRow[] | null>(null)
  const control = useControl()
  const toast = useToast()
  const clock = useClock()

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

  const [selection, setSelection] = useState<Selection>({ kind: 'network' })
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['net']))
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
  const [trends, setTrends] = useState<TrendStatus>({ running: false, startedAt: 0, stoppedAt: 0, interval: 10, nextRead: 0, mode: 'auto', points: [], samples: 0, file: '', earliest: 0 })
  const [netIssues, setNetIssues] = useState(0)
  const [capturing, setCapturing] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

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

  const trendRows = async (list: ObjectRow[]) => {
    try {
      const points = list.filter((r) => (r.values['present-value'] !== undefined && r.typeId !== 8) || isTrendLog(r))
      if (!points.length) throw new Error('None of these objects has a present value or a log to trend.')
      const res = await api.trendAdd(points)
      setTrends(res)
      const added = res.added
      const logs = res.points.filter((p) => added.includes(p.id) && p.log).length
      const what = added.length ? `Added ${added.length} point${added.length === 1 ? '' : 's'} to Trends` : 'Those points are already in Trends'
      toast(logs ? `${what}. Reading the history from ${logs === 1 ? 'the trend log' : `${logs} trend logs`}…` : what, {
        undo: added.length
          ? async () => {
              let t = res as TrendStatus
              for (const id of added) t = await api.trendRemove(id)
              setTrends(t)
            }
          : undefined,
      })
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  const showInObjects = (p: TrendPoint) => showRow({ device: p.device, key: `${p.device}:${p.typeId},${p.instance}` })
  const showRow = (r: { device: number; key: string }) => {
    setPlace('objects')
    setView('objects')
    select({ kind: 'object', device: r.device, key: r.key })
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
    setExpanded((e) => new Set([...e, 'net']))
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
      setExpanded((e) => new Set([...e, 'net']))
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
    if (selection.kind !== 'network' && selection.device === inst) setSelection({ kind: 'network' })
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

  // ---- selection: clicking a device reads it if it has not been read yet ----
  const isReading = (inst: number) => jobs.some((j) => j.device === inst && j.state === 'running')
  const select = (s: Selection) => {
    setSelection(s)
    if (s.kind === 'device') {
      setExpanded((e) => new Set([...e, `dev:${s.device}`]))
      if (!(rows[s.device] ?? []).length && !isReading(s.device) && status.connected) startRead([s.device])
    }
    if (s.kind === 'type') setExpanded((e) => new Set([...e, `dev:${s.device}`]))
    if (s.kind === 'object') {
      const row = (rows[s.device] ?? []).find((r) => r.key === s.key)
      if (row) setExpanded((e) => new Set([...e, `dev:${s.device}`, `type:${s.device}:${row.values['Object type']}`]))
      setTimeout(() => document.querySelector(`[data-row-key="${CSS.escape(s.key)}"]`)?.scrollIntoView({ block: 'nearest' }), 50)
    }
  }
  const toggleExpanded = (id: string) =>
    setExpanded((e) => {
      const next = new Set(e)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

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
  const scopeDeviceId = selection.kind === 'network' ? null : selection.device
  const scopeDevice = scopeDeviceId === null ? null : visibleDevices.find((d) => d.instance === scopeDeviceId) ?? null
  const typeFilter = selection.kind === 'type' ? selection.type : selection.kind === 'object' ? selection.type ?? null : null

  const scopeRows = useMemo(() => {
    const base = scopeDeviceId === null ? visibleDevices.flatMap((d) => rows[d.instance] ?? []) : rows[scopeDeviceId] ?? []
    return typeFilter ? base.filter((r) => r.values['Object type'] === typeFilter) : base
  }, [rows, scopeDeviceId, visibleDevices, typeFilter])

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
      (r) => (scopeDeviceId === null || r.device === scopeDeviceId) && (!typeFilter || r.values['Object type'] === typeFilter),
    )
    return compareRows(scopeRows, then, false).length
  }, [baseline, scopeRows, scopeDeviceId, typeFilter])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const searchCols = ['object-name', 'Object type', 'Instance', ...columns]
    let list = scopeRows.filter((r) => {
      if (queryNode && !evaluate(queryNode, r)) return false
      if (q && !searchCols.some((c) => (r.values[c] ?? r.errors[c] ?? '').toLowerCase().includes(q))) return false
      return true
    })
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
  }, [scopeRows, queryNode, search, columns, sort])

  const selectedKey = selection.kind === 'object' ? selection.key : null
  const selectedRow = selectedKey ? scopeRows.find((r) => r.key === selectedKey) ?? null : null
  // a device's own properties are its device object's properties
  const subject =
    selectedRow ?? (selection.kind === 'device' ? (rows[selection.device] ?? []).find((r) => r.typeId === 8 && r.instance === selection.device) ?? null : null)
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

  // bulk writes act on what the filter shows; a single point is commanded from the drawer
  const writableShown = view === 'objects' && filtered.length > 0 ? filtered.filter((r) => r.typeId !== 8 && (WRITABLE_TYPES.has(r.typeId) || control.fieldsOf(r).length > 0)).slice(0, 2000) : []
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
      if (!filtered.length) throw new Error('No rows match the current filters, so there is nothing to export.')
      if (!cols.length) throw new Error('Choose at least one property to export.')
      const name = kind === 'csv' ? exportCsv(filtered, cols, includeErrors) : await exportXlsx(filtered, cols, includeErrors, sheetPerDevice, deviceLabel)
      toast(`Exported ${filtered.length} rows to ${name}`)
    } catch (e) {
      toast(message(e), { kind: 'error' })
    }
  }

  // closing the drawer goes back to what the tree had in scope, never further out
  const closeDrawer = () =>
    setSelection(scopeDevice ? (typeFilter ? { kind: 'type', device: scopeDevice.instance, type: typeFilter } : { kind: 'device', device: scopeDevice.instance }) : { kind: 'network' })
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
      if (typing) return
      if (e.key === 'Escape' && selection.kind === 'object') closeDrawer()
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && filtered.length) {
        e.preventDefault()
        const i = filtered.findIndex((r) => r.key === selectedKey)
        const next = e.key === 'ArrowDown' ? Math.min(filtered.length - 1, i + 1) : Math.max(0, i === -1 ? 0 : i - 1)
        select({ kind: 'object', device: filtered[next].device, key: filtered[next].key, type: typeFilter ?? undefined })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const title = scopeDevice ? scopeDevice.name || `Device ${scopeDevice.instance}` : 'All devices'

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
    <Empty title="Click a device in the tree to read it" text="Its objects fill this table. Choose columns with the Columns button, then export." />
  ) : null

  const crumbs: { label: string; go?: () => void }[] = [{ label: 'Network', go: () => select({ kind: 'network' }) }]
  if (scopeDevice) crumbs.push({ label: scopeDevice.name || `Device ${scopeDevice.instance}`, go: () => select({ kind: 'device', device: scopeDevice.instance }) })
  if (typeFilter && scopeDevice) crumbs.push({ label: typeFilter })
  if (selectedRow) crumbs.push({ label: selectedRow.values['object-name'] || selectedRow.key })

  return (
    <div className="flex h-screen overflow-hidden bg-(--surface-page) text-(--text-strong)">
      {writeRows && <WritePointsSheet rows={writeRows} onClose={() => setWriteRows(null)} onWritten={() => { control.refresh(); rereadRows(writeRows) }} />}
      <ColumnsSheet open={columnsOpen} onOpenChange={setColumnsOpen} allRows={allRows} columns={columns} onColumns={setColumns} presets={presets} onPresets={setPresets} />
      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        rowCount={filtered.length}
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
      />
      <Rail
        status={booted ? mark.status : 'busy'}
        statusText={booted ? mark.text : 'Starting…'}
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
      />
      {place === 'trends' ? (
        <TrendsView
          status={status}
          trends={trends}
          onTrends={setTrends}
          onShowInObjects={showInObjects}
          onGoToObjects={() => setPlace('objects')}
          allRows={allRows}
          devices={visibleDevices}
          onAddRows={trendRows}
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
        rows={rows}
        selection={selection}
        onSelect={select}
        expanded={expanded}
        onToggle={toggleExpanded}
        searching={searching}
        onConnect={() => setConnectOpen(true)}
        onSearch={searchDevices}
        onAddByIp={addByIp}
        onRead={(inst, retry) => startRead([inst], retry)}
        onReadAll={() => startRead(visibleDevices.map((d) => d.instance))}
        onCancel={cancelJob}
        onRemove={removeDevice}
        onSaveSite={saveSite}
        onOpenSite={openSite}
        booting={!booted}
      />
      </Pane>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[52px] shrink-0 items-center gap-2 pr-2 pl-2">
          <PaneToggle side="left" />
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[13px] whitespace-nowrap text-(--text-muted)">
            {crumbs.map((c, i) => (
              <span key={i} className="flex min-w-0 items-center gap-1.5">
                {i > 0 ? <ArrowRight className="size-3 shrink-0 text-(--ink-4)" /> : null}
                {i === crumbs.length - 1 || !c.go ? (
                  <span className={i === crumbs.length - 1 ? 'truncate font-medium text-(--text-strong)' : 'truncate'}>{c.label}</span>
                ) : (
                  <button className="truncate hover:text-(--text-strong)" onClick={c.go}>
                    {c.label}
                  </button>
                )}
              </span>
            ))}
          </nav>
          <div className="flex-1" />

          {!booted ? (
            <Skeleton className="h-[34px] w-[150px] rounded-full" />
          ) : (
          // Novacore's Live pill: hours and minutes in ink, seconds quieter, then the connection as a tinted badge
          <span className="inline-flex h-[34px] shrink-0 items-center gap-2.5 rounded-full border border-(--border-subtle) bg-(--surface-card) pr-[5px] pl-3.5 text-[13px] tracking-[-0.005em] whitespace-nowrap shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <span className="tabular-nums">
              <span className="font-medium text-(--text-strong)">{clock.slice(0, 5)}</span>
              <span className="text-(--text-faint)">{clock.slice(5)}</span>
            </span>
            <Badge className={`h-6 px-2.5 text-[11.5px] lowercase text-(--ink) ${status.connected ? 'bg-(--status-ok)' : 'bg-(--status-alarm)'}`} tone={status.connected ? 'success' : 'danger'}>
              {status.connected ? 'live' : 'offline'}
            </Badge>
          </span>
          )}
          <PaneToggle side="right" />
        </header>

        <div className="flex min-h-0 flex-1 gap-[10px] px-3 pb-3">
          <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-(--border-subtle) bg-(--surface-card) shadow-(--shadow-sheet)">
            <div key={`${scopeDeviceId}`} className="nc-view-in flex min-h-0 flex-1 flex-col">
              <div className="flex items-start gap-4 px-[18px] pt-[18px] pb-3">
                <div className="min-w-0 flex-1">
                  <h1 className="m-0 truncate text-[20px] font-medium tracking-[-0.02em]">{title}</h1>
                  {scopeDevice ? (
                    <div className="mt-1 flex min-w-0 items-center gap-2 text-[12px] text-(--text-muted)">
                      <span className="truncate">
                        #{scopeDevice.instance} · {scopeDevice.address}
                        {scopeDevice.vendorName ? ` · ${scopeDevice.vendorName}` : ''}
                        {scopeDevice.model ? ` · ${scopeDevice.model}` : ''}
                      </span>
                      {typeFilter ? (
                        <span className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full bg-(--surface-track) pr-0.5 pl-2.5 text-(--text-strong)">
                          {typeFilter} only
                          <button
                            aria-label="Show every object type"
                            onClick={() => select({ kind: 'device', device: scopeDevice.instance })}
                            className="inline-flex size-[18px] items-center justify-center rounded-full text-(--text-muted) hover:bg-(--surface-card) hover:text-(--text-strong)"
                          >
                            <XIcon className="size-3" />
                          </button>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {writableShown.length > 0 ? (
                  <Button size="sm" variant="secondary" disabled={!status.connected} title={status.connected ? undefined : 'Connect to the network to write'} onClick={() => setWriteRows(writableShown)}>
                    Write {writableShown.length} shown
                  </Button>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => setColumnsOpen(true)} disabled={!allRows.length}>
                  <Columns3 />
                  Columns
                  <span className="rounded-full bg-(--surface-track) px-1.5 text-[11px] leading-[18px] tabular-nums text-(--text-muted)">{columns.length}</span>
                </Button>
                <Button size="sm" disabled={!scopeRows.length} onClick={() => setExportOpen(true)}>
                  Export
                </Button>
              </div>

              {scopeRows.length > 0 ? (
                <div className="border-b border-(--border-subtle) px-[18px]">
                  <Tabs value={view} onValueChange={(v) => setView(v as typeof view)}>
                    <TabsList variant="underline" className="w-auto gap-6 border-b-0">
                      <TabsTab value="objects">
                        Objects
                        <span className="rounded-full bg-(--surface-track) px-1.5 text-[11px] leading-[18px] tabular-nums text-(--text-muted)">{scopeRows.length}</span>
                      </TabsTab>
                      <TabsTab value="health">
                        Health check
                        {healthIssues ? (
                          <span className="rounded-full bg-(--color-ns-yellow) px-1.5 text-[11px] leading-[18px] tabular-nums text-(--ink)">{healthIssues}</span>
                        ) : (
                          <span className="inline-flex size-[18px] items-center justify-center rounded-full bg-(--color-ns-green-light)">
                            <CheckIcon className="size-3 text-(--ink)" />
                          </span>
                        )}
                      </TabsTab>
                      <TabsTab value="changes">
                        Changes
                        {baseline ? (
                          <span className="rounded-full bg-(--surface-track) px-1.5 text-[11px] leading-[18px] tabular-nums text-(--text-muted)">{changeCount}</span>
                        ) : null}
                      </TabsTab>
                    </TabsList>
                  </Tabs>
                </div>
              ) : null}

              {/* objects: the search field is the header row of the table, boxed like the packet log */}
              <div className={view === 'objects' && scopeRows.length > 0 ? 'mx-[18px] mt-3.5 mb-[18px] flex min-h-0 flex-1 flex-col overflow-hidden rounded-[14px] border border-(--border-subtle)' : 'contents'}>
              {view === 'objects' && scopeRows.length > 0 ? (
                  <FilterField
                    embedded
                    ref={searchRef}
                    rows={scopeRows}
                    props={filterable}
                    query={query}
                    onQuery={setQuery}
                    search={search}
                    onSearch={setSearch}
                    matchCount={filtered.length}
                    totalCount={scopeRows.length}
                    onTrend={() => trendRows(filtered)}
                    onSaveCheck={(name: string, severity: Severity, q: string) => {
                      setSavedChecks((c) => [...c, { id: `${Date.now()}`, name, severity, query: q }])
                      toast(`Saved "${name}". It runs in Health check from now on.`)
                    }}
                  />
              ) : scopeRows.length > 0 ? (
                <div className="h-3.5 shrink-0" />
              ) : null}

              <ScrollArea scrollFade scrollFadeSides={{ left: false, top: false }} clampContentMinWidth={view !== 'objects'} className="min-h-0 flex-1">
                {view === 'changes' && scopeRows.length > 0 ? (
                  <Changes
                    rows={scopeRows}
                    deviceIds={scopeDeviceId === null ? null : [scopeDeviceId]}
                    typeFilter={typeFilter}
                    baseline={baseline}
                    onBaseline={setBaseline}
                    selectedKey={selectedKey}
                    onSelect={(r) => setSelection({ kind: 'object', device: r.device, key: r.key })}
                  />
                ) : view === 'health' && scopeRows.length > 0 ? (
                  <HealthCheck
                    rows={scopeRows}
                    selectedKey={selectedKey}
                    onSelect={(r) => setSelection({ kind: 'object', device: r.device, key: r.key })}
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
                    <Empty title="No objects match" text="Try a shorter search, or switch the filter to All." />
                  ) : (
                    <ObjectTable
                      held={control.heldByKey}
                      rows={filtered}
                      columns={columns}
                      sort={sort}
                      onSort={(c) => setSort((s) => (s?.column !== c ? { column: c, dir: 1 } : s.dir === 1 ? { column: c, dir: -1 } : null))}
                      selectedKey={selectedKey}
                      onSelect={(k) => {
                        const r = scopeRows.find((x) => x.key === k)
                        if (!r) return
                        if (k === selectedKey) closeDrawer()
                        else select({ kind: 'object', device: r.device, key: k, type: typeFilter ?? undefined })
                      }}
                      showDevice={!scopeDevice && visibleDevices.length > 1}
                      loading={!!loading}
                      onAddColumn={() => setColumnsOpen(true)}
                      onRemoveColumn={(c) => setColumns(columns.filter((x) => x !== c))}
                    />
                  )
                ) : (
                  emptyState
                )}
              </ScrollArea>
              </div>
            </div>
          </section>

          <Pane side="right" gap={10}>
          <PropertiesPanel
            subject={subject}
            hasRows={allRows.length > 0}
            columns={columns}
            onToggleColumn={toggleColumn}
            onOpenColumns={() => setColumnsOpen(true)}
            onClearSubject={closeDrawer}
            canRead={status.connected}
            onReread={() => subject && startRead([subject.device], false, [[subject.typeId, subject.instance]])}
            onTrend={
              subject && isTrendLog(subject)
                ? async () => {
                    // a log's history is the point: add it if needed, then go to the chart
                    if (!trends.points.some((p) => p.device === subject.device && p.typeId === subject.typeId && p.instance === subject.instance)) await trendRows([subject])
                    setPlace('trends')
                  }
                : subject && subject.values['present-value'] !== undefined && subject.typeId !== 8
                  ? () => trendRows([subject])
                  : undefined
            }
            trendLabel={subject && isTrendLog(subject) ? 'Show history' : undefined}
            trended={!!subject && !isTrendLog(subject) && trends.points.some((p) => p.device === subject.device && p.typeId === subject.typeId && p.instance === subject.instance)}
            onWritten={() => subject && rereadRows([subject])}
            onOpenSchedules={() => setPlace('schedules')}
          />
          </Pane>
        </div>
      </main>
      </>
      )}

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
