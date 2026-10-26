import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, type ControlAction, type ControlLog, type FieldSpec, type ObjectRow, type Writable } from '../api'

type ControlState = {
  writable: Writable | null
  log: ControlLog
  /** read the action log again; call after anything is written */
  refresh: () => void
  /** priority slots BACon holds, by object key */
  heldByKey: Map<string, ControlAction[]>
  /** what BACon can write on this object, among the properties it has */
  fieldsOf: (row: ObjectRow) => [string, FieldSpec][]
}

const Context = createContext<ControlState | null>(null)

/** App-wide: what can be written (once), and BACon's own action log (after every write), so every screen can show
 * what BACon did next to what the controller reports. */
export function ControlProvider({ children }: { children: ReactNode }) {
  const [writable, setWritable] = useState<Writable | null>(null)
  const [log, setLog] = useState<ControlLog>({ actions: [], held: [] })
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((n) => n + 1), [])

  useEffect(() => {
    let live = true
    api.writable().then((w) => live && setWritable(w)).catch(() => {})
    return () => {
      live = false
    }
  }, [])
  useEffect(() => {
    let live = true
    api.controlLog().then((l) => live && setLog(l)).catch(() => {})
    return () => {
      live = false
    }
  }, [tick])

  // stable while the catalogue is, so screens can depend on it without reloading after every write
  const fieldsOf = useCallback(
    (row: ObjectRow): [string, FieldSpec][] => {
      const specs = writable?.types[String(row.typeId)] ?? {}
      return Object.entries(specs).filter(([prop]) => row.values[prop] !== undefined || row.errors[prop] !== undefined)
    },
    [writable],
  )
  const value = useMemo<ControlState>(() => {
    const heldByKey = new Map<string, ControlAction[]>()
    for (const h of log.held) heldByKey.set(h.key, [...(heldByKey.get(h.key) ?? []), h])
    return { writable, log, refresh, heldByKey, fieldsOf }
  }, [writable, log, refresh, fieldsOf])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useControl() {
  const value = useContext(Context)
  if (!value) throw new Error('useControl needs a ControlProvider')
  return value
}
