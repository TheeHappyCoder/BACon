"""Trend recording: present-value of chosen points, plus the history held in the controllers' own trend logs.

Points are recorded in trend groups the user names (a chiller, an AHU), each with its own interval and mode and its own
start and stop. Groups, their points and every sample are kept in BACon's data folder for KEEP_DAYS days.

Per point, COV is tried first (the controller pushes changes, almost no traffic). Subscriptions are unconfirmed with a
5-minute lifetime that bacpypes3 renews, so they expire by themselves if this PC disappears. A point whose controller
refuses COV is polled instead, batched with ReadPropertyMultiple and one request per controller at a time, so a big
trend never floods a controller. Nothing is ever written to a device.

A Trend Log (or each channel of a Trend Log Multiple) is a point too: adding it reads the newest MAX_BACKFILL records of
the log's buffer with ReadRange, so its history lands on the chart straight away; while recording, new records are read
every LOG_EVERY seconds by sequence number (or by time, for controllers that do not number their records).
"""

import asyncio
import json
import os
import sqlite3
import time
from dataclasses import dataclass, field

from bacpypes3.apdu import ErrorRejectAbortNack, ReadPropertyMultipleRequest
from bacpypes3.basetypes import LogMultipleRecord, LogRecord, PropertyReference, ReadAccessSpecification
from bacpypes3.constructeddata import SequenceOf
from bacpypes3.pdu import Address
from bacpypes3.primitivedata import ObjectIdentifier
from bacpypes3.vendor import get_vendor_info

from .paths import KEEP_DAYS, clean_old, data_dir
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
    next_due: float = 0.0  # when the next timed read is due (wall clock), for the countdown

    def to_json(self):
        data = {
            "id": self.id, "device": self.device, "typeId": self.type_id, "instance": self.instance, "name": self.name,
            "deviceName": self.device_name, "units": self.units, "method": self.method, "last": self.last, "lastT": self.last_t,
            "samples": self.samples, "error": self.error, "note": self.note, "min": self.lo, "max": self.hi,
            "avg": (self.total / self.numeric) if self.numeric else None,
            "sourceType": self.source_type, "channel": self.channel, "nextDue": self.next_due,
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


@dataclass
class TrendGroup:
    """A trend the user named (a chiller, an AHU): its points, how often it records, and whether it is recording."""
    id: int
    name: str
    interval: float = 60.0
    mode: str = "auto"  # auto: COV, polled when refused / poll: read on the interval
    point_ids: list = field(default_factory=list)
    running: bool = False
    started_at: float = 0.0
    stopped_at: float = 0.0

    def to_json(self, points: dict):
        mine = [points[i] for i in self.point_ids if i in points]
        due = [p.next_due for p in mine if p.next_due]
        return {
            "id": self.id, "name": self.name, "interval": self.interval, "mode": self.mode, "pointIds": [p.id for p in mine],
            "running": self.running, "startedAt": self.started_at, "stoppedAt": self.stopped_at,
            "nextRead": min(due) if self.running and due else 0.0,
            "samples": sum(p.samples for p in mine),
        }


class TrendSession:
    """Every trend group, the points they record, and one history database shared by all of them. A point in several
    groups is recorded once: subscribed for COV if any running group records on change, read at the fastest interval
    of the running groups it is in. Groups and points are kept in a file, so they are there after a restart."""

    def __init__(self, client: BacnetClient):
        self.client = client
        self.points: dict[int, TrendPoint] = {}
        self.groups: dict[int, TrendGroup] = {}
        self.next_id = 1
        self.next_group = 1
        self.tasks: list[asyncio.Task] = []
        self.log_tasks: set[asyncio.Task] = set()
        self.logs: dict[tuple[int, int, int], LogSource] = {}
        self.queue: list[tuple] = []
        self.earliest = 0.0
        self.folder = data_dir("trends")
        self.state_path = os.path.join(self.folder, "groups.json")
        self._open_db()
        self._load()

    @property
    def running(self) -> bool:
        return any(g.running for g in self.groups.values())

    # -- storage -----------------------------------------------------------------

    def _open_db(self):
        clean_old(self.folder)  # recordings from before groups, and anything else left a month
        self.db_path = os.path.join(self.folder, "history.sqlite")
        self.db = sqlite3.connect(self.db_path, check_same_thread=False)
        self.db.execute("pragma journal_mode=wal")
        self.db.execute("create table if not exists samples (point integer, t real, v real, text text)")
        self.db.execute("create index if not exists samples_pt on samples (point, t)")
        self.db.execute("delete from samples where t < ?", (time.time() - KEEP_DAYS * 86400,))
        self.db.commit()

    def _save(self):
        def point_json(p: TrendPoint):
            return {
                "id": p.id, "device": p.device, "address": p.address, "type_id": p.type_id, "instance": p.instance, "name": p.name,
                "device_name": p.device_name, "units": p.units, "source_type": p.source_type, "channel": p.channel,
                "log_interval": p.log.interval if p.log else None,
            }

        data = {
            "next_id": self.next_id, "next_group": self.next_group,
            "points": [point_json(p) for p in self.points.values()],
            "groups": [{"id": g.id, "name": g.name, "interval": g.interval, "mode": g.mode, "points": g.point_ids} for g in self.groups.values()],
        }
        tmp = self.state_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, self.state_path)

    def _load(self):
        try:
            with open(self.state_path, encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return
        self.next_id = int(data.get("next_id", 1))
        self.next_group = int(data.get("next_group", 1))
        for d in data.get("points", []):
            p = TrendPoint(
                id=d["id"], device=d["device"], address=d["address"], type_id=d["type_id"], instance=d["instance"], name=d["name"],
                device_name=d.get("device_name", ""), units=d.get("units", ""), source_type=d.get("source_type"), channel=d.get("channel"),
            )
            if p.type_id in LOG_TYPES:
                key = (p.device, p.type_id, p.instance)
                src = self.logs.get(key) or LogSource(device=p.device, address=p.address, type_id=p.type_id, instance=p.instance, interval=d.get("log_interval") or 0.0)
                self.logs[key] = src
                p.method, p.log = "log", src
                src.points[p.channel or 0] = p
            self.points[p.id] = p
        for d in data.get("groups", []):
            self.groups[d["id"]] = TrendGroup(id=d["id"], name=d["name"], interval=float(d.get("interval", 60)), mode=d.get("mode", "auto"), point_ids=list(d.get("points", [])))
        # what is already recorded: counts and ranges, and where each log's history ends, so reading resumes there
        for pid, n, lo, hi, total, numeric, first, last_t in self.db.execute(
            "select point, count(*), min(v), max(v), sum(v), count(v), min(t), max(t) from samples group by point"
        ):
            p = self.points.get(pid)
            if p is None:
                continue
            p.samples, p.lo, p.hi, p.total, p.numeric, p.last_t = n, lo, hi, total or 0.0, numeric, last_t
            p.last = (self.db.execute("select text from samples where point = ? order by t desc limit 1", (pid,)).fetchone() or [""])[0]
            p.method = p.method if p.log else "stopped"
            self.earliest = min(self.earliest or first, first)
            if p.log:
                p.log.last_t = max(p.log.last_t, last_t)
                p.log.state = "ready"

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

    # -- groups ------------------------------------------------------------------

    def create_group(self, name: str, interval: float, mode: str) -> TrendGroup:
        g = TrendGroup(id=self.next_group, name=name.strip() or f"Trend {self.next_group}", interval=_clamp(interval), mode=_mode(mode))
        self.next_group += 1
        self.groups[g.id] = g
        self._save()
        return g

    def update_group(self, gid: int, name: str | None, interval: float | None, mode: str | None) -> TrendGroup:
        g = self.groups[gid]
        if name is not None and name.strip():
            g.name = name.strip()
        if interval is not None:
            g.interval = _clamp(interval)
        if mode is not None:
            g.mode = _mode(mode)
        self._save()
        if g.running:
            self._restart_workers()  # a new interval or mode applies straight away
        return g

    async def delete_group(self, gid: int):
        g = self.groups.pop(gid, None)
        if g is None:
            return
        # points no other group records go, with their history
        used = {i for other in self.groups.values() for i in other.point_ids}
        self._drop([i for i in g.point_ids if i not in used])
        self._save()
        self._restart_workers()

    def add_to_group(self, gid: int, rows: list[dict], devices: dict, objects: dict | None = None) -> list[int]:
        """Add object rows to a group. A point another group already records is shared, not read twice."""
        g = self.groups[gid]
        ids = self._points_for(rows, devices, objects)
        added = [i for i in ids if i not in g.point_ids]
        g.point_ids.extend(added)
        self._save()
        if self.running and added:
            self._restart_workers()
        return added

    def remove_from_group(self, gid: int, pid: int):
        g = self.groups[gid]
        g.point_ids = [i for i in g.point_ids if i != pid]
        if not any(pid in other.point_ids for other in self.groups.values()):
            self._drop([pid])
        self._save()
        if self.running:
            self._restart_workers()

    async def start(self, gid: int, devices: dict):
        if self.client.app is None:
            raise RuntimeError("Connect to a network first.")
        g = self.groups[gid]
        if not g.point_ids:
            raise RuntimeError("Add some points to this group first.")
        for p in self.points.values():  # a controller that moved to another address is followed there
            d = devices.get(p.device)
            if d is not None:
                p.address = d.address
                if p.log:
                    p.log.address = d.address
        g.running = True
        g.started_at = g.started_at or time.time()
        g.stopped_at = 0.0
        self._restart_workers()

    async def stop(self, gid: int | None = None):
        """Stop one group, or every group (on disconnect)."""
        for g in self.groups.values():
            if gid is None or g.id == gid:
                if g.running:
                    g.running = False
                    g.stopped_at = time.time()
        await self._stop_workers()
        if self.running:
            self._restart_workers()
        self.flush()
        recording = self._wanted()
        for p in self.points.values():
            if p.id not in recording and p.method in ("cov", "poll", "waiting"):
                p.method = "stopped" if p.samples else "waiting"
                p.next_due = 0.0

    # -- points ------------------------------------------------------------------

    def _points_for(self, rows: list[dict], devices: dict, objects: dict | None) -> list[int]:
        """The point ids for these rows, made where there is none yet. A trend log's row carries
        detail["log-device-object-property"] from the read; the objects it logs are looked up in `objects` for their
        name, units and type. A trend-log-multiple gives one point per channel."""
        ids = []
        existing = {(p.device, p.type_id, p.instance, p.channel): p.id for p in self.points.values()}
        for r in rows:
            dev, type_id, inst = int(r["device"]), int(r["typeId"]), int(r["instance"])
            if dev not in devices:
                continue
            values = r.get("values", {})
            name = values.get("object-name", "") or f"{values.get('Object type', type_id)} {inst}"
            common = dict(device=dev, address=devices[dev].address, type_id=type_id, instance=inst, device_name=devices[dev].name)
            if type_id not in LOG_TYPES:
                pid = existing.get((dev, type_id, inst, None))
                if pid is None:
                    p = TrendPoint(id=self.next_id, name=name, units=values.get("units", ""), **common)
                    self.next_id += 1
                    self.points[p.id] = p
                    pid = existing[(dev, type_id, inst, None)] = p.id
                ids.append(pid)
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
                pid = existing.get((dev, type_id, inst, ch))
                if pid is not None:
                    ids.append(pid)
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
                existing[(dev, type_id, inst, ch)] = p.id
                ids.append(p.id)
                fresh = True
            if fresh:
                self.logs[key] = src
                src.reset()  # a channel added to a log already read: read the whole history again
                self.fetch_log(src)
        return ids

    def _drop(self, ids: list[int]):
        for i in ids:
            p = self.points.pop(i, None)
            if p and p.log:
                p.log.points = {c: x for c, x in p.log.points.items() if x.id != i}
                if not p.log.points:
                    self.logs.pop((p.log.device, p.log.type_id, p.log.instance), None)
        if ids:
            self.flush()
            self.db.executemany("delete from samples where point = ?", [(i,) for i in ids])
            self.db.commit()

    def fetch_log(self, src: "LogSource"):
        """Read the log's history now, in the background, when connected."""
        if self.client.app is None:
            return
        task = asyncio.create_task(self.sync_log(src))
        self.log_tasks.add(task)
        task.add_done_callback(self.log_tasks.discard)

    # -- running -----------------------------------------------------------------

    def _wanted(self) -> dict[int, dict]:
        """Each point some running group records: COV wanted, its timer, and the timer to fall back to if COV is
        refused (the fastest of the groups that asked)."""
        out: dict[int, dict] = {}
        for g in self.groups.values():
            if not g.running:
                continue
            for pid in g.point_ids:
                if pid not in self.points:
                    continue
                e = out.setdefault(pid, {"cov": False, "every": None, "fallback": None})
                if g.mode == "auto":
                    e["cov"] = True
                    e["fallback"] = min(e["fallback"] or g.interval, g.interval)
                else:
                    e["every"] = min(e["every"] or g.interval, g.interval)
        return out

    async def _stop_workers(self):
        for t in self.tasks:
            t.cancel()
        await asyncio.gather(*self.tasks, return_exceptions=True)  # leaving the COV contexts cancels the subscriptions
        self.tasks = []

    def _restart_workers(self):
        for t in self.tasks:
            t.cancel()
        self.tasks = []
        wanted = self._wanted()
        if not wanted:
            return
        self.tasks.append(asyncio.create_task(self._flusher()))
        by_device: dict[int, list[tuple[TrendPoint, dict]]] = {}
        logs = set()
        for pid, e in wanted.items():
            p = self.points[pid]
            if p.log is None:
                by_device.setdefault(p.device, []).append((p, e))
            else:
                logs.add((p.log.device, p.log.type_id, p.log.instance))
        for entries in by_device.values():
            self.tasks.append(asyncio.create_task(self._device_worker(entries)))
        if logs:
            self.tasks.append(asyncio.create_task(self._log_worker(logs)))

    async def _log_worker(self, keys: set):
        while True:
            for key in keys:
                src = self.logs.get(key)
                if src is not None and src.state != "unsupported":
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
        while True:
            await asyncio.sleep(1.0)
            self.flush()

    async def _device_worker(self, entries: list[tuple[TrendPoint, dict]]):
        """COV per point where a group wants it and the controller accepts it; the rest is read on each point's own
        timer, due points batched into one ReadPropertyMultiple, one request to the controller at a time."""
        every: dict[int, float] = {p.id: e["every"] for p, e in entries if e["every"]}
        by_id = {p.id: p for p, _ in entries}
        due: dict[int, float] = {}
        cov_tasks = []

        def refused(p: TrendPoint, fallback: float):
            every[p.id] = min(every.get(p.id) or fallback, fallback)

        for p, e in entries:
            if e["cov"]:
                cov_tasks.append(asyncio.create_task(self._cov(p, e["fallback"] or 60.0, refused)))
                await asyncio.sleep(0.05)  # don't fire hundreds of subscribe requests at once
        try:
            await asyncio.sleep(2.0 if cov_tasks else 0)  # let subscriptions settle before reading the rest
            while True:
                now = time.monotonic()
                ready = [by_id[i] for i, sec in every.items() if due.get(i, 0) <= now]
                for i in range(0, len(ready), POLL_BATCH):
                    await self._poll(ready[i : i + POLL_BATCH])
                done = time.monotonic()
                for p in ready:
                    due[p.id] = done + every[p.id]
                    p.next_due = time.time() + every[p.id]
                upcoming = [due.get(i, done) for i in every]
                await asyncio.sleep(max(0.2, (min(upcoming) if upcoming else done + 1) - time.monotonic()))
        finally:
            for t in cov_tasks:
                t.cancel()
            await asyncio.gather(*cov_tasks, return_exceptions=True)

    async def _cov(self, p: TrendPoint, fallback: float, refused):
        app = self.client.app
        oid = ObjectIdentifier((p.type_id, p.instance))
        try:
            async with app.change_of_value(Address(p.address), oid, issue_confirmed_notifications=False, lifetime=COV_LIFETIME) as scm:
                p.method = "cov"
                p.error = ""
                await self._poll([p])  # COV only reports changes, so take the current value now
                while True:
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
            # the controller refused the subscription: read this point on the timer instead
            p.method = "poll"
            p.error = ""
            p.note = error_text(e) if isinstance(e, ErrorRejectAbortNack) else str(e)
            refused(p, fallback)

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
            "groups": [g.to_json(self.points) for g in self.groups.values()],
            "points": [p.to_json() for p in self.points.values()],
            "samples": sum(p.samples for p in self.points.values()),
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

    def stats(self, ids: list[int], since: float, until: float):
        """Per point over the range: count, min, max, the time-weighted average (a COV point reports only changes, so
        each value counts for as long as it held), first and last, how often it changed, and how long it spent in
        each value it took (for on/off and states: runtime and share)."""
        self.flush()
        until = until or time.time()
        out = {}
        for i in ids:
            # the value in force when the range opens counts from the start of the range
            before = self.db.execute("select t, v, text from samples where point = ? and t < ? order by t desc limit 1", (i, since)).fetchone()
            rows = self.db.execute("select t, v, text from samples where point = ? and t >= ? and t <= ? order by t", (i, since, until)).fetchall()
            n = len(rows)
            if before:
                rows = [(since, before[1], before[2]), *rows]
            if not rows:
                out[str(i)] = None
                continue
            nums = [r[1] for r in rows if r[1] is not None]
            weighted = held = 0.0
            states: dict[str, float] = {}
            changes = 0
            for k, (t, v, text) in enumerate(rows):
                end = rows[k + 1][0] if k + 1 < len(rows) else max(until, t)
                span = max(0.0, min(end, until) - t)
                states[text] = states.get(text, 0.0) + span
                if v is not None:
                    weighted += v * span
                    held += span
                if k and text != rows[k - 1][2]:
                    changes += 1
            out[str(i)] = {
                "count": n, "min": min(nums) if nums else None, "max": max(nums) if nums else None,
                "avg": (weighted / held) if held else (sum(nums) / len(nums) if nums else None),
                "first": rows[0][1], "firstText": rows[0][2], "last": rows[-1][1], "lastText": rows[-1][2],
                "from": rows[0][0], "to": min(until, max(rows[-1][0], until)),
                "changes": changes, "states": states if len(states) <= 32 else None,
            }
        return out

    def export_rows(self, ids: list[int] | None = None, since: float = 0):
        """Samples oldest first, as (time, point, value, text): of some points, or every point."""
        self.flush()
        if ids is None:
            return self.db.execute("select t, point, v, text from samples where t >= ? order by t", (since,)).fetchall()
        marks = ",".join("?" * len(ids)) or "null"
        return self.db.execute(f"select t, point, v, text from samples where point in ({marks}) and t >= ? order by t", (*ids, since)).fetchall()


def _clamp(interval: float) -> float:
    return max(1.0, min(float(interval or 60), MAX_INTERVAL))


def _mode(mode: str) -> str:
    return mode if mode in ("auto", "poll") else "auto"
