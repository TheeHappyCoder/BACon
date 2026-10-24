"""Trend recording: present-value of chosen points, plus the history held in the controllers' own trend logs.

Per point, COV is tried first (the controller pushes changes, almost no traffic). Subscriptions are unconfirmed with a
5-minute lifetime that bacpypes3 renews, so they expire by themselves if this PC disappears. A point whose controller
refuses COV is polled instead, batched with ReadPropertyMultiple and one request per controller at a time, so a big
trend never floods a controller. Nothing is ever written to a device.

A Trend Log (or each channel of a Trend Log Multiple) is a point too: adding it reads the newest MAX_BACKFILL records of
the log's buffer with ReadRange, so its history lands on the chart straight away; while recording, new records are read
every LOG_EVERY seconds by sequence number (or by time, for controllers that do not number their records).
"""

import asyncio
import os
import sqlite3
import time
from dataclasses import dataclass

from bacpypes3.apdu import ErrorRejectAbortNack, ReadPropertyMultipleRequest
from bacpypes3.basetypes import LogMultipleRecord, LogRecord, PropertyReference, ReadAccessSpecification
from bacpypes3.constructeddata import SequenceOf
from bacpypes3.pdu import Address
from bacpypes3.primitivedata import ObjectIdentifier
from bacpypes3.vendor import get_vendor_info

from .paths import clean_old, data_dir
from .client import BACnetError, BacnetClient, error_text
from .decode import decode_any_raw, decode_value, fmt

PV = 85  # present-value
POLL_BATCH = 16  # objects per ReadPropertyMultiple
COV_LIFETIME = 300
MAX_INTERVAL = 24 * 3600  # seconds; slow sites log every 30 min or hour
LOG_TYPES = (20, 27)  # trend-log, trend-log-multiple
RECORD_COUNT = 141
MAX_BACKFILL = 10_000  # newest records read from a log when it is added
LOG_EVERY = 30  # seconds between reads of new log records while recording
BINARY = (3, 4, 5)


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
    source_type: int | None = None  # for a trend log: the type of the object it logs (binary logs draw as steps)
    channel: int | None = None  # for a trend-log-multiple: which logged property
    log: "LogSource | None" = None

    def to_json(self):
        data = {
            "id": self.id, "device": self.device, "typeId": self.type_id, "instance": self.instance, "name": self.name,
            "deviceName": self.device_name, "units": self.units, "method": self.method, "last": self.last, "lastT": self.last_t,
            "samples": self.samples, "error": self.error, "note": self.note, "min": self.lo, "max": self.hi,
            "avg": (self.total / self.numeric) if self.numeric else None,
            "sourceType": self.source_type, "channel": self.channel,
        }
        if self.log:
            data["log"] = self.log.to_json()
        return data


@dataclass
class LogSource:
    """One trend log on a controller, shared by its points (one, or one per channel of a trend-log-multiple)."""
    device: int
    address: str
    type_id: int
    instance: int
    interval: float = 0.0  # the log's own interval in seconds (0: on change or triggered)
    state: str = "waiting"  # waiting / loading / ready / error / unsupported
    loaded: int = 0
    total: int = 0
    error: str = ""
    seq: int | None = None  # sequence number of the newest record read, when the controller numbers them
    last_t: float = 0.0
    chunk: int = 100
    fetched_at: float = 0.0

    def __post_init__(self):
        self.points: dict[int, TrendPoint] = {}  # channel (0 for a plain trend log) -> point
        self.lock = asyncio.Lock()

    def reset(self):
        self.seq, self.last_t, self.loaded = None, 0.0, 0

    def to_json(self):
        return {
            "state": self.state, "loaded": self.loaded, "total": self.total, "error": self.error,
            "interval": self.interval, "fetchedAt": self.fetched_at,
        }


def _epoch(dt) -> float | None:
    """A log record's local date-time as epoch seconds; None when it has wildcards."""
    d, t = tuple(dt.date), tuple(dt.time)
    if 255 in (d[0], d[1], d[2]) or t[0] == 255:
        return None
    return time.mktime((d[0] + 1900, d[1], d[2], t[0], t[1] % 255, t[2] % 255, 0, 0, -1)) + (t[3] % 255) / 100


def _datum_text(datum, source_type: int | None) -> str | None:
    """A log value as the text the chart and tables show; None for status entries (log disabled, buffer purged...)."""
    v = getattr(datum, "realValue", None)
    if v is not None:
        return fmt(float(v))
    for name in ("unsignedValue", "signedValue"):
        v = getattr(datum, name, None)
        if v is not None:
            return str(int(v))
    v = getattr(datum, "enumValue", None)
    if v is not None:
        if source_type in BINARY and int(v) in (0, 1):
            return "active" if int(v) else "inactive"
        return str(int(v))
    v = getattr(datum, "booleanValue", None)
    if v is not None:
        return "true" if int(v) else "false"
    v = getattr(datum, "bitstringValue", None)
    if v is not None:
        return fmt(v)
    v = getattr(datum, "anyValue", None)
    if v is not None:
        return decode_any_raw(v)
    return None


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
        self.log_tasks: set[asyncio.Task] = set()
        self.logs: dict[tuple[int, int, int], LogSource] = {}
        self.queue: list[tuple] = []
        self.earliest = 0.0
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
        self.earliest = min(self.earliest or t, t)
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

    def add(self, rows: list[dict], devices: dict, objects: dict | None = None) -> list[int]:
        """Rows are object rows. A trend log's row carries detail["log-device-object-property"] from the read; the
        objects it logs are looked up in `objects` for their name, units and type."""
        added = []
        existing = {(p.device, p.type_id, p.instance, p.channel) for p in self.points.values()}
        for r in rows:
            dev, type_id, inst = int(r["device"]), int(r["typeId"]), int(r["instance"])
            if dev not in devices:
                continue
            values = r.get("values", {})
            name = values.get("object-name", "") or f"{values.get('Object type', type_id)} {inst}"
            common = dict(device=dev, address=devices[dev].address, type_id=type_id, instance=inst, device_name=devices[dev].name)
            if type_id not in LOG_TYPES:
                if (dev, type_id, inst, None) not in existing:
                    p = TrendPoint(id=self.next_id, name=name, units=values.get("units", ""), **common)
                    self.next_id += 1
                    self.points[p.id] = p
                    existing.add((dev, type_id, inst, None))
                    added.append(p.id)
                continue
            key = (dev, type_id, inst)
            src = self.logs.get(key)
            if src is None:
                try:
                    interval = float(values.get("log-interval") or 0) / 100  # hundredths of a second
                except ValueError:
                    interval = 0.0
                src = LogSource(device=dev, address=devices[dev].address, type_id=type_id, instance=inst, interval=interval)
            refs = (r.get("detail") or {}).get("log-device-object-property") or [None]
            fresh = False
            for channel, ref in enumerate(refs if type_id == 27 else refs[:1]):
                ch = channel if type_id == 27 else None
                if (dev, type_id, inst, ch) in existing:
                    continue
                target = {}
                if ref:
                    ref_dev = ref.get("device") or dev
                    target = ((objects or {}).get(ref_dev, {}).get(f"{ref_dev}:{ref['object'][0]},{ref['object'][1]}") or {}).get("values", {})
                logged = target.get("object-name", "")
                p = TrendPoint(
                    id=self.next_id, name=f"{name} · {logged}" if ch is not None and logged else name,
                    units=target.get("units", ""), source_type=ref["object"][0] if ref else None, channel=ch,
                    method="log", log=src, **common,
                )
                self.next_id += 1
                self.points[p.id] = p
                src.points[ch or 0] = p
                existing.add((dev, type_id, inst, ch))
                added.append(p.id)
                fresh = True
            if fresh:
                self.logs[key] = src
                src.reset()  # a channel added to a log already read: read the whole history again
                self.fetch_log(src)
        if self.running and added:
            self._restart_workers()
        return added

    def fetch_log(self, src: "LogSource"):
        """Read the log's history now, in the background, when connected."""
        if self.client.app is None:
            return
        task = asyncio.create_task(self.sync_log(src))
        self.log_tasks.add(task)
        task.add_done_callback(self.log_tasks.discard)

    def remove(self, ids: list[int]):
        for i in ids:
            p = self.points.pop(i, None)
            if p and p.log:
                p.log.points = {c: x for c, x in p.log.points.items() if x.id != i}
                if not p.log.points:
                    self.logs.pop((p.log.device, p.log.type_id, p.log.instance), None)
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
        for t in self.log_tasks:
            t.cancel()
        self.points.clear()
        self.logs.clear()
        self.queue.clear()
        self.started_at = self.stopped_at = self.earliest = 0.0
        self.db.close()
        self._new_db()

    def _restart_workers(self):
        for t in self.tasks:
            t.cancel()
        self.tasks = [asyncio.create_task(self._flusher())]
        by_device: dict[int, list[TrendPoint]] = {}
        for p in self.points.values():
            if p.log is None:
                by_device.setdefault(p.device, []).append(p)
        for device, points in by_device.items():
            self.tasks.append(asyncio.create_task(self._device_worker(points)))
        if self.logs:
            self.tasks.append(asyncio.create_task(self._log_worker()))

    async def _log_worker(self):
        while self.running:
            for src in list(self.logs.values()):
                if src.state != "unsupported":
                    await self.sync_log(src)
            await asyncio.sleep(LOG_EVERY)

    # -- trend logs --------------------------------------------------------------

    async def sync_log(self, src: LogSource):
        """Read the log's records newer than the newest one read; the first time, the newest MAX_BACKFILL."""
        if self.client.app is None:
            return
        async with src.lock:
            oid = ObjectIdentifier((src.type_id, src.instance))
            try:
                if src.seq is None and not src.last_t:
                    src.state, src.error, src.loaded = "loading", "", 0
                    count = int(decode_value(None, RECORD_COUNT, await self.client.rp(src.address, oid, RECORD_COUNT)) or 0)
                    start = max(1, count - MAX_BACKFILL + 1)
                    src.total = count - start + 1 if count else 0
                    if count:
                        await self._read_records(src, oid, "position", start)
                elif src.seq is not None:
                    await self._read_records(src, oid, "sequence", src.seq + 1)
                else:
                    await self._read_records(src, oid, "time", src.last_t)
                src.state, src.error = "ready", ""
                src.fetched_at = time.time()
            except asyncio.CancelledError:
                raise
            except (Exception, ErrorRejectAbortNack) as e:
                text = error_text(e)
                if "unrecognized-service" in text:
                    src.state = "unsupported"
                    src.error = "This controller does not support ReadRange, so the log's history cannot be read."
                elif "no-response" in text or text == "timeout":
                    src.state, src.error = "error", "The controller did not answer. Check it is online, then read the log again."
                else:
                    src.state, src.error = "error", text
            finally:
                self.flush()

    async def _read_records(self, src: LogSource, oid, by: str, ref):
        while True:
            try:
                ack = await self.client.read_range(src.address, oid, by, ref, src.chunk)
            except BACnetError as e:
                text = error_text(e)
                if "unrecognized-service" in text:
                    raise
                if src.chunk > 4 and any(x in text for x in ("segmentation", "buffer-overflow", "too-long", "window")):
                    src.chunk = max(4, src.chunk // 2)  # the answer did not fit in one packet: ask for fewer
                    continue
                if "no-response" in text and src.chunk > 25:
                    # some controllers drop an answer too big to send instead of aborting; an offline one is
                    # silent too, so try smaller only twice before giving up
                    src.chunk //= 2
                    continue
                if by == "time":
                    by, ref = "position", 1  # no read by time either: read from the start, keeping newer records only
                    continue
                raise
            n = int(ack.itemCount or 0)
            first_seq = ack.firstSequenceNumber
            for t, values in self._decode_records(src, ack):
                if by != "sequence" and src.last_t and t <= src.last_t:
                    continue  # already read: reads by position or time can overlap
                for ch, text in values.items():
                    p = src.points.get(ch)
                    if p is not None and text is not None:
                        self._record(p, text, t)
                src.last_t = max(src.last_t, t)
                src.loaded += 1
            if first_seq is not None and n:
                src.seq = int(first_seq) + n - 1
            flags = list(ack.resultFlags or [])
            if n == 0 or (len(flags) > 1 and flags[1]):  # last-item
                return
            if src.seq is not None:
                by, ref = "sequence", src.seq + 1
            elif by == "position":
                ref += n
            else:
                ref = src.last_t

    def _decode_records(self, src: LogSource, ack) -> list[tuple[float, dict[int, str | None]]]:
        out = []
        if src.type_id == 20:
            p = src.points.get(0)
            for rec in ack.itemData.cast_out(SequenceOf(LogRecord)):
                t = _epoch(rec.timestamp)
                if t is not None:
                    out.append((t, {0: _datum_text(rec.logDatum, p.source_type if p else None)}))
            return out
        for rec in ack.itemData.cast_out(SequenceOf(LogMultipleRecord)):
            t = _epoch(rec.timestamp)
            data = rec.logData.logData if rec.logData is not None else None
            if t is None or data is None:
                continue  # status and time-change entries
            values = {}
            for ch, datum in enumerate(data):
                p = src.points.get(ch)
                values[ch] = _datum_text(datum, p.source_type if p else None)
            out.append((t, values))
        return out

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
            "earliest": self.earliest,
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
