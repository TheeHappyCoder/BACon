import { useEffect, useState } from 'react'
import { api, type UpdateStatus } from '../api'
import { Button } from '../ui/components/button'
import { Dialog, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '../ui/components/dialog'
import { AppMark } from './AppMark'

const MB = (n: number) => `${(n / 1048576).toFixed(1)} MB`

/** About BACon and updates: the current version, what's new in the latest release, and one button that downloads,
 *  verifies and restarts into it. */
export function UpdateDialog({
  open,
  onOpenChange,
  update,
  onUpdate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  update: UpdateStatus | null
  onUpdate: (u: UpdateStatus) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [restarting, setRestarting] = useState(false)
  const u = update

  // follow the download while it runs
  useEffect(() => {
    if (u?.state !== 'downloading') return
    const t = setInterval(() => api.update().then(onUpdate).catch(() => {}), 400)
    return () => clearInterval(t)
  }, [u?.state, onUpdate])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const check = () => run(async () => onUpdate(await api.update(true, true)))
  const download = () => run(async () => onUpdate(await api.updateDownload()))
  const restart = () =>
    run(async () => {
      await api.updateApply()
      setRestarting(true)
    })

  const pct = u && u.total ? Math.round((100 * u.done) / u.total) : 0
  const message = error || u?.error || ''

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-[440px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AppMark size={30} status="healthy" />
            <div>
              <DialogTitle className="text-[17px] font-medium tracking-[-0.01em]">BACon</DialogTitle>
              <p className="m-0 mt-0.5 text-[12px] text-(--text-muted)">BACnet, on site · version {u?.current ?? '…'}</p>
            </div>
          </div>
        </DialogHeader>
        <div className="flex flex-col gap-3 border-y border-(--border-subtle) bg-(--surface-card) px-5 py-4 text-[13px]">
          {restarting ? (
            <p className="m-0 text-(--text-strong)">Restarting into BACon {u?.latest}. This window closes in a moment.</p>
          ) : u?.available ? (
            <>
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-medium text-(--text-strong)">BACon {u.latest} is available</span>
                {u.published ? <span className="text-[12px] text-(--text-muted)">{new Date(u.published).toLocaleDateString()}</span> : null}
              </div>
              {u.notes ? (
                <div className="max-h-48 overflow-auto rounded-[12px] bg-(--surface-card-muted) px-3 py-2.5 text-[12.5px] whitespace-pre-wrap text-(--text-muted)">{u.notes}</div>
              ) : null}
              {u.state === 'downloading' || u.state === 'ready' ? (
                <div className="flex flex-col gap-1.5">
                  <div className="h-1.5 overflow-hidden rounded-full bg-(--surface-track)">
                    <span className="block h-full rounded-full bg-(--ink) transition-[width] duration-300" style={{ width: `${u.state === 'ready' ? 100 : Math.max(3, pct)}%` }} />
                  </div>
                  <span className="text-[12px] tabular-nums text-(--text-muted)">
                    {u.state === 'ready' ? 'Downloaded and verified.' : `Downloading… ${MB(u.done)} of ${MB(u.total)}`}
                  </span>
                </div>
              ) : null}
              {!u.canInstall ? (
                <p className="m-0 text-[12px] text-(--text-muted)">
                  You're running from source, so get it from{' '}
                  <a className="text-(--action-primary) underline-offset-4 hover:underline" href={u.url} target="_blank" rel="noreferrer">
                    the release page
                  </a>
                  .
                </p>
              ) : null}
            </>
          ) : (
            <p className="m-0 text-(--text-muted)">{u?.latest && !u.error ? "You're on the latest version." : 'Checks GitHub for new releases.'}</p>
          )}
          {message ? <p className="m-0 text-[12px] text-(--status-alarm-strong)">{message}</p> : null}
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {u?.state === 'ready' ? (
            <Button size="sm" onClick={restart} loading={busy || restarting}>
              Restart and update
            </Button>
          ) : u?.canInstall ? (
            <Button size="sm" onClick={download} loading={busy || u.state === 'downloading'}>
              {u.state === 'failed' ? 'Try again' : 'Update now'}
            </Button>
          ) : (
            <Button variant="secondary" size="sm" onClick={check} loading={busy}>
              Check for updates
            </Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
