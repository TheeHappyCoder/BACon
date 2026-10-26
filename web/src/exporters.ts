import { api, type ObjectRow } from './api'

/** The columns that say which object a row is. Shown in the table's first cell; optionally prepended to exports. */
export const IDENTITY_COLUMNS = ['Device', 'Device name', 'Object type', 'Instance', 'object-name']
export const SYNTHETIC_COLUMNS = ['Device', 'Device name', 'Object type', 'Instance', 'Read status']
export const DEFAULT_COLUMNS = ['description', 'present-value']

export type CellState = { kind: 'value'; text: string } | { kind: 'error'; text: string } | { kind: 'missing' }

export function cell(row: ObjectRow, column: string): CellState {
  const value = row.values[column]
  if (value !== undefined) return { kind: 'value', text: value }
  const error = row.errors[column]
  if (error !== undefined) return { kind: 'error', text: error }
  return { kind: 'missing' }
}

export function exportText(row: ObjectRow, column: string, includeErrors: boolean): string {
  const c = cell(row, column)
  if (c.kind === 'value') return c.text
  if (c.kind === 'error') return includeErrors ? `#ERROR: ${c.text}` : ''
  return ''
}

export function exportColumns(columns: string[], includeIdentity: boolean): string[] {
  if (!includeIdentity) return columns
  return [...IDENTITY_COLUMNS.filter((c) => !columns.includes(c)), ...columns]
}

function stamp() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

export function exportCsv(rows: ObjectRow[], columns: string[], includeErrors: boolean): string {
  const quote = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)
  const lines = [columns.map(quote).join(',')]
  for (const row of rows) lines.push(columns.map((c) => quote(exportText(row, c, includeErrors))).join(','))
  const filename = `bacnet-export-${stamp()}.csv`
  // BOM so Excel opens UTF-8 correctly
  download(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), filename)
  return filename
}

export async function exportXlsx(
  rows: ObjectRow[],
  columns: string[],
  includeErrors: boolean,
  sheetPerDevice: boolean,
  deviceName: (instance: number) => string,
): Promise<string> {
  const toRows = (list: ObjectRow[]) => list.map((r) => columns.map((c) => exportText(r, c, includeErrors)))
  let sheets
  if (sheetPerDevice) {
    const groups = new Map<number, ObjectRow[]>()
    for (const r of rows) groups.set(r.device, [...(groups.get(r.device) ?? []), r])
    sheets = [...groups].map(([inst, list]) => ({ name: deviceName(inst), columns, rows: toRows(list) }))
  } else {
    sheets = [{ name: 'BACnet objects', columns, rows: toRows(rows) }]
  }
  const filename = `bacnet-export-${stamp()}.xlsx`
  download(await api.exportXlsx(filename, sheets), filename)
  return filename
}
