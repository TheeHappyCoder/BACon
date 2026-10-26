import { useState } from 'react'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { Hugeicons } from '../ui/components/hugeicons'
import { Switch } from '../ui/components/switch'

const { FileText, FileSpreadsheet } = Hugeicons

/** Exports what the table shows: the filtered rows, with the columns chosen in Columns. */
export function ExportDialog({
  open,
  onOpenChange,
  rowCount,
  columnCount,
  chosenCount,
  includeIdentity,
  onIncludeIdentity,
  sheetPerDevice,
  onSheetPerDevice,
  includeErrors,
  onIncludeErrors,
  onChangeColumns,
  onExport,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  rowCount: number
  columnCount: number
  /** the columns chosen in Columns; 0 means nothing chosen */
  chosenCount: number
  includeIdentity: boolean
  onIncludeIdentity: (b: boolean) => void
  sheetPerDevice: boolean
  onSheetPerDevice: (b: boolean) => void
  includeErrors: boolean
  onIncludeErrors: (b: boolean) => void
  /** closes the dialog and opens the Columns sheet */
  onChangeColumns: () => void
  onExport: (kind: 'csv' | 'xlsx') => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const disabled = rowCount === 0 || chosenCount === 0 || busy
  const run = async (kind: 'csv' | 'xlsx') => {
    setBusy(true)
    try {
      await onExport(kind)
      onOpenChange(false)
    } finally {
      setBusy(false)
    }
  }

  const option = (label: string, note: string, checked: boolean, onChange: (b: boolean) => void) => (
    <label className="flex items-center justify-between gap-4">
      <span className="flex min-w-0 flex-col">
        <span className="text-[13px]">{label}</span>
        <span className="text-[12px] text-(--text-muted)">{note}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">Export</DialogTitle>
          <p className="m-0 mt-0.5 text-[12px] tabular-nums text-(--text-muted)">
            {rowCount} rows × {columnCount} columns
          </p>
        </DialogHeader>
        <div className="flex flex-col gap-4 border-y border-(--border-subtle) bg-(--surface-card) px-5 py-4">
          {chosenCount === 0 ? (
            <div className="flex items-center justify-between gap-3 rounded-[12px] bg-(--status-warn-bg) px-3 py-2.5 text-[12.5px] leading-snug">
              <span>No columns chosen. Choose at least one property to export.</span>
              <Button variant="ghost" size="xs" className="shrink-0" onClick={onChangeColumns}>
                Change columns
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="m-0 text-[12.5px] leading-snug text-(--text-muted)">Rows are what the filter shows. Columns are the ones chosen in Columns.</p>
              <Button variant="ghost" size="xs" className="shrink-0" onClick={onChangeColumns}>
                Change columns
              </Button>
            </div>
          )}
          {option('Add device and object id', 'Device, device name, object type, instance and name come first.', includeIdentity, onIncludeIdentity)}
          {option('Excel: a sheet per device', 'CSV always writes one file.', sheetPerDevice, onSheetPerDevice)}
          {option('Write read errors in cells', 'Otherwise a property the controller refused is left blank.', includeErrors, onIncludeErrors)}
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <span className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={disabled} onClick={() => void run('csv')}>
              <FileText />
              CSV file
            </Button>
            <Button size="sm" disabled={disabled} onClick={() => void run('xlsx')}>
              <FileSpreadsheet />
              Excel workbook
            </Button>
          </span>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
