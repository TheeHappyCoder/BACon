"""Trend recording: present-value of chosen points, stored on disk.

Per point, COV is tried first (the controller pushes changes, almost no traffic). Subscriptions are unconfirmed with a
5-minute lifetime that bacpypes3 renews, so they expire by themselves if this PC disappears. A point whose controller
refuses COV is polled instead, batched with ReadPropertyMultiple and one request per controller at a time, so a big
trend never floods a controller. Nothing is ever written to a device.
"""

import asyncio
import os
import sqlite3
import time
from dataclasses import dataclass

from bacpypes3.apdu import ErrorRejectAbortNack, ReadPropertyMultipleRequest
from bacpypes3.basetypes import PropertyReference, ReadAccessSpecification
from bacpypes3.pdu import Address
from bacpypes3.primitivedata import ObjectIdentifier
from bacpypes3.vendor import get_vendor_info

from .paths import clean_old, data_dir
from .client import BACnetError, BacnetClient, error_text
from .decode import decode_value, fmt

PV = 85  # present-value
POLL_BATCH = 16  # objects per ReadPropertyMultiple
COV_LIFETIME = 300
MAX_INTERVAL = 24 * 3600  # seconds; slow sites log every 30 min or hour


def _number(text: str):
    try:
        return float(text)
    except (TypeError, ValueError):
        return {"active": 1.0, "inactive": 0.0, "true": 1.0, "false": 0.0}.get((text or "").strip().lower())


@dataclass
class TrendPoint:
    id: int
    device: int
    address: str
    type_id: int
    instance: int
    name: str
    device_name: str
    units: str
    method: str = "waiting"  # waiting / cov / poll / error
    last: str = ""
    last_t: float = 0.0
    samples: int = 0
    error: str = ""
    note: str = ""  # why COV was not used, when it was refused
    lo: float | None = None
    hi: float | None = None
    total: float = 0.0
    numeric: int = 0

    def to_json(self):
        return {
            "id": self.id, "device": self.device, "typeId": self.type_id, "instance": self.instance, "name": self.name,
            "deviceName": self.device_name, "units": self.units, "method": self.method, "last": self.last, "lastT": self.last_t,
            "samples": self.samples, "error": self.error, "note": self.note, "min": self.lo, "max": self.hi,
            "avg": (self.total / self.numeric) if self.numeric else None,
        }


class TrendSession:
    def __init__(self, client: BacnetClient):
        self.client = client
        self.points: dict[int, TrendPoint] = {}
        self.next_id = 1
        self.running = False
        self.started_at = 0.0
        self.stopped_at = 0.0
        self.interval = 10.0
        self.next_read = 0.0  # when the next timed read is due (wall clock), so the UI can count down
        self.mode = "auto"
        self.tasks: list[asyncio.Task] = []
        self.queue: list[tuple] = []
        self._new_db()

    # -- storage -----------------------------------------------------------------

    def _new_db(self):
        folder = data_dir("trends")
        clean_old(folder)
        self.db_path = os.path.join(folder, time.strftime("trend-%Y%m%d-%H%M%S.sqlite"))
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.execute("pragma journal_mode=wal")
        self.db.execute("create table if not exists samples (point integer, t real, v real, text text)")
        self.db.execute("create index if not exists samples_pt on samples (point, t)")
        self.db.commit()

    def _record(self, p: TrendPoint, text: str, t: float | None = None):
        t = t or time.time()
        v = _number(text)
        p.last, p.last_t = text, t
        p.samples += 1
        if v is not None:
            p.lo = v if p.lo is None else min(p.lo, v)
            p.hi = v if p.hi is None else max(p.hi, v)
            p.total += v
            p.numeric += 1
        self.queue.append((p.id, t, v, text))

    def flush(self):
        if not self.queue:
            return
        batch, self.queue = self.queue, []
        self.db.executemany("insert into samples values (?, ?, ?, ?)", batch)
        self.db.commit()

    # -- points ------------------------------------------------------------------

    def add(self, rows: list[dict], devices: dict) -> list[int]:
        added = []
        existing = {(p.device, p.type_id, p.instance) for p in self.points.values()}
        for r in rows:
            key = (int(r["device"]), int(r["typeId"]), int(r["instance"]))
            if key in existing or key[0] not in devices:
                continue
            values = r.get("values", {})
            p = TrendPoint(
                id=self.next_id, device=key[0], address=devices[key[0]].address, type_id=key[1], instance=key[2],
                name=values.get("object-name", "") or f"{values.get('Object type', key[1])} {key[2]}",
                device_name=devices[key[0]].name, units=values.get("units", ""),
            )
            self.next_id += 1
            self.points[p.id] = p
            existing.add(key)
            added.append(p.id)
        if self.running and added:
            self._restart_workers()
        return added

    def remove(self, ids: list[int]):
        for i in ids:
            self.points.pop(i, None)
        if self.running:
            self._restart_workers()

    # -- running -----------------------------------------------------------------

    async def start(self, interval: float, mode: str):
        if self.client.app is None:
            raise RuntimeError("Connect to a network first.")
        self.interval = max(1.0, min(interval, MAX_INTERVAL))
        self.mode = mode if mode in ("auto", "poll") else "auto"
        self.running = True
        self.started_at = self.started_at or time.time()
        self.stopped_at = 0.0
        self._restart_workers()

    async def stop(self):
        self.running = False
        self.next_read = 0.0
        self.stopped_at = time.time()
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)  # leaving the COV contexts cancels the subscriptions
        self.tasks = []
        self.flush()
        for p in self.points.values():
            if p.method in ("cov", "poll", "waiting"):
                p.method = "stopped" if p.samples else "waiting"

    def clear(self):
        self.points.clear()
        self.queue.clear()
        self.started_at = self.stopped_at = 0.0
        self.db.close()
        self._new_db()

    def _restart_workers(self):
        for t in self.tasks:
            t.cancel()
        self.tasks = [asyncio.create_task(self._flusher())]
        by_device: dict[int, list[TrendPoint]] = {}
        for p in self.points.values():
            by_device.setdefault(p.device, []).append(p)
        for device, points in by_device.items():
            self.tasks.append(asyncio.create_task(self._device_worker(points)))

    async def _flusher(self):
        while self.running:
            await asyncio.sleep(1.0)
            self.flush()

    async def _device_worker(self, points: list[TrendPoint]):
        """COV per point where the controller accepts it; everything else is polled in batches."""
        polled: list[TrendPoint] = []
        cov_tasks = []
        if self.mode == "auto":
            for p in points:
                cov_tasks.append(asyncio.create_task(self._cov(p, polled)))
                await asyncio.sleep(0.05)  # don't fire hundreds of subscribe requests at once
        else:
            polled.extend(points)
        try:
            await asyncio.sleep(2.0)  # let subscriptions settle before polling the rest
            while self.running:
                started = time.monotonic()
                for i in range(0, len(polled), POLL_BATCH):
                    await self._poll(polled[i : i + POLL_BATCH])
                delay = max(0.2, self.interval - (time.monotonic() - started))
                if polled:
                    self.next_read = time.time() + delay
                await asyncio.sleep(delay)
        finally:
            for t in cov_tasks:
                t.cancel()
            await asyncio.gather(*cov_tasks, return_exceptions=True)

    async def _cov(self, p: TrendPoint, polled: list[TrendPoint]):
        app = self.client.app
        oid = ObjectIdentifier((p.type_id, p.instance))
        try:
            async with app.change_of_value(Address(p.address), oid, issue_confirmed_notifications=False, lifetime=COV_LIFETIME) as scm:
                p.method = "cov"
                p.error = ""
                await self._poll([p])  # COV only reports changes, so take the current value now
                while self.running:
                    pid, value = await scm.get_value()
                    if int(pid) == PV:
                        try:
                            text = fmt(value)
                        except Exception:
                            text = str(value)
                        self._record(p, text)
        except asyncio.CancelledError:
            raise
        except (Exception, ErrorRejectAbortNack) as e:
            # the controller refused the subscription: poll this point instead
            p.method = "poll"
            p.error = ""
            p.note = error_text(e) if isinstance(e, ErrorRejectAbortNack) else str(e)
            if p not in polled:
                polled.append(p)

    async def _poll(self, points: list[TrendPoint]):
        if not points or self.client.app is None:
            return
        specs = [
            ReadAccessSpecification(objectIdentifier=ObjectIdentifier((p.type_id, p.instance)), listOfPropertyReferences=[PropertyReference(propertyIdentifier=PV)])
            for p in points
        ]
        request = ReadPropertyMultipleRequest(listOfReadAccessSpecs=specs, destination=Address(points[0].address))
        try:
            ack = await self.client.app.request(request)
        except BACnetError as e:
            for p in points:
                if p.method != "cov":
                    p.method, p.error = "error", error_text(e)
            return
        by_key = {(p.type_id, p.instance): p for p in points}
        for result in ack.listOfReadAccessResults:
            oid = result.objectIdentifier
            p = by_key.get((int(oid[0]), int(oid[1])))
            if p is None:
                continue
            for el in result.listOfResults:
                rr = el.readResult
                if rr.propertyValue is None:
                    p.method, p.error = "error", error_text(rr.propertyAccessError)
                    continue
                cls = get_vendor_info(0).get_object_class(p.type_id) if p.type_id < 128 else None
                if p.method in ("waiting", "error", "stopped"):
                    p.method = "poll"
                p.error = ""
                self._record(p, decode_value(cls, PV, rr.propertyValue))

    # -- views -------------------------------------------------------------------

    def status(self):
        return {
            "running": self.running,
            "startedAt": self.started_at,
            "stoppedAt": self.stopped_at,
            "interval": self.interval,
            "nextRead": self.next_read if self.running else 0.0,
            "mode": self.mode,
            "points": [p.to_json() for p in self.points.values()],
            "samples": sum(p.samples for p in self.points.values()),
            "file": os.path.basename(self.db_path),
        }

    def series(self, ids: list[int], since: float, until: float, buckets: int):
        """Each point's samples in the range, bucketed to at most `buckets` rows of (t, avg, min, max)."""
        self.flush()
        until = until or time.time()
        width = max((until - since) / max(buckets, 1), 0.001)
        out = {}
        for i in ids:
            rows = self.db.execute(
                "select cast((t - ?) / ? as integer) as b, avg(t), avg(v), min(v), max(v), max(text) from samples "
                "where point = ? and t >= ? and t <= ? group by b order by b",
                (since, width, i, since, until),
            ).fetchall()
            out[str(i)] = [[r[1], r[2], r[3], r[4], r[5]] for r in rows]
        return out

    def export_rows(self):
        """Every sample, oldest first: (time, point)."""
        self.flush()
        return self.db.execute("select t, point, v, text from samples order by t").fetchall()
