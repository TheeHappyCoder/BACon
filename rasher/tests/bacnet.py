"""BACnet regression checks: start an isolated Rasher with one device of each type and check each over BACnet/IP.

    python rasher/tests/bacnet.py              # every type, against tests/baselines
    python rasher/tests/bacnet.py --update     # write the baselines from this run (only from a known-good commit)
    python rasher/tests/bacnet.py --types vav  # just some types

For each device: every object and property (ReadPropertyMultiple "all") against its baseline, live values aside; then
what a BMS does: SubscribeCOV on every analog, binary and multi-state object, write and relinquish at priority 8 on
every writable point, a refused write to an input, the profile's alarms with COV status flags matching ReadProperty,
ReadRange on every trend log, the I-Am storm, and no errors in the activity log. The points and writes come from
GET /profile, so a new profile is checked without changes here; give it alarm SCENARIOS and a baseline.

Rasher runs on its own HTTP port with its settings in a temporary folder, so a Rasher you have open is left alone.
Devices use this PC's address on UDP ports from 47830 (47808 is often taken). Needs bacpypes3.
"""

import argparse
import asyncio
import contextlib
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
BASELINES = os.path.join(HERE, "baselines")

# what makes each profile alarm: (control actions, the object that should leave normal)
SCENARIOS = {
    "fcu": [
        ([{"action": "window", "value": True}], "binary-input,1"),
        ([{"action": "temp", "value": 27.5}], "analog-input,1"),
        ([{"action": "window", "value": False}, {"action": "people", "value": 12}, {"action": "speed", "value": 120}], "analog-input,4"),
    ],
    "meter": [
        ([{"action": "fault", "name": "phase", "value": True}], "binary-input,1"),
        ([{"action": "load", "value": 90}, {"action": "speed", "value": 120}], "analog-input,3"),
    ],
    "vav": [
        ([{"action": "temp", "value": 27.5}], "analog-input,1"),
    ],
}

# Properties whose values the model, the clock or the network change: compared by presence only.
LIVE = {
    "present-value", "local-time", "local-date", "controlled-variable-value", "setpoint", "record-count",
    "total-record-count", "event-state", "status-flags", "acked-transitions", "event-time-stamps", "reliability",
    "active-cov-subscriptions", "device-address-binding", "current-command-priority",
}


def http(base, method, path, body=None, timeout=60):
    r = urllib.request.Request(base + path, data=json.dumps(body).encode() if body is not None else None, method=method,
                               headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read())


# ---- the object dump ------------------------------------------------------------------------------------------------


def _enc(v):
    if v is None or isinstance(v, (bool, int, str)):
        return v
    if isinstance(v, float):
        return round(v, 4)
    if isinstance(v, (list, tuple)):
        return [_enc(x) for x in v]
    if hasattr(v, "dict_contents"):
        try:
            return v.dict_contents()
        except Exception:
            pass
    return str(v)


def normalise(dump: dict, instance: int) -> dict:
    """The dump with what depends on where and when it ran taken out: the device's instance and name, the network
    port's addressing, live values, and which priorities hold a value rather than what they hold."""
    out = {}
    for key, props in dump.items():
        k = "device" if key == f"device,{instance}" else key
        if not isinstance(props, dict):
            out[k] = props
            continue
        p = {}
        for prop, v in props.items():
            if k.startswith("network-port"):
                p[prop] = "(this PC)"
            elif prop in LIVE:
                p[prop] = "(live)"
            elif prop == "priority-array":
                p[prop] = ["set" if isinstance(x, dict) and "null" not in x else "-" for x in v]
            elif k == "device" and prop in ("object-identifier", "object-list"):
                p[prop] = json.loads(json.dumps(v).replace(f"[8, {instance}]", "[8, 0]"))
            elif k == "device" and prop == "object-name":
                p[prop] = "(prefix-instance)"
            else:
                p[prop] = v
        out[k] = p
    return out


def diff(base: dict, now: dict) -> list[str]:
    lines = []
    for o in sorted(set(base) | set(now)):
        a, b = base.get(o), now.get(o)
        if a is None or b is None:
            lines.append(f"{o}: {'missing' if b is None else 'new'}")
            continue
        if not isinstance(a, dict):
            if a != b:
                lines.append(f"{o}: {a} -> {b}")
            continue
        for p in sorted(set(a) | set(b)):
            if a.get(p) != b.get(p):
                lines.append(f"{o} {p}: {str(a.get(p))[:80]} -> {str(b.get(p))[:80]}")
    return lines


# ---- one device's checks (run as a worker process, one per device, side by side) -----------------------------------


async def check_device(base: str, instance: int, cport: int, update: bool) -> int:
    from bacpypes3.apdu import ErrorRejectAbortNack, GetAlarmSummaryRequest, ReadRangeRequest, SubscribeCOVRequest
    from bacpypes3.app import Application
    from bacpypes3.argparse import SimpleArgumentParser
    from bacpypes3.basetypes import DateTime, Range, RangeByPosition, RangeBySequenceNumber, RangeByTime, StatusFlags
    from bacpypes3.pdu import Address
    from bacpypes3.primitivedata import Date, Enumerated, Null, ObjectIdentifier, Real, Time, Unsigned

    fails = []

    def check(ok, *msg):
        print(f"  {'ok  ' if ok else 'FAIL'} {instance} " + " ".join(map(str, msg)), flush=True)
        if not ok:
            fails.append(msg)

    cov, iams = [], []

    class App(Application):
        async def do_UnconfirmedCOVNotificationRequest(self, apdu):
            flags = {str(e.propertyIdentifier): e.value for e in apdu.listOfValues}.get("status-flags")
            cov.append((str(apdu.monitoredObjectIdentifier), list(flags.cast_out(StatusFlags)) if flags is not None else None))

        async def do_IAmRequest(self, apdu):
            iams.append(str(apdu.iAmDeviceIdentifier))

    desc = http(base, "GET", f"/api/d/{instance}/profile")
    dev = next(d for d in http(base, "GET", "/api/devices") if d["instance"] == instance)
    kind = desc["type"]
    prefix = http(base, "GET", f"/api/d/{instance}/state")["device"]["prefix"]
    args = SimpleArgumentParser().parse_args(["--address", f"{dev['ip']}/{prefix}:{cport}", "--instance", str(4100000 + cport % 10000),
                                              "--name", f"rasher-tests-{cport}", "--vendoridentifier", "999"])
    app = App.from_args(args)
    addr = Address(f"{dev['ip']}:{dev['port']}")
    oid = lambda key: ObjectIdentifier((key.split(",")[0], int(key.split(",")[1])))
    rp = lambda key, prop: app.read_property(addr, oid(key), prop)
    control = lambda body: http(base, "POST", f"/api/d/{instance}/control", body)
    try:
        # every object and property, on the fresh device, against the baseline
        devid = ObjectIdentifier(("device", instance))
        objs = await app.read_property(addr, devid, "object-list")
        dump = {}
        for o in objs:
            try:
                dump[str(o)] = {str(p) + (f"[{i}]" if i is not None else ""): _enc(v) for _, p, i, v in await app.read_property_multiple(addr, [o, ["all"]])}
            except ErrorRejectAbortNack as e:
                dump[str(o)] = {"error": str(e)}
        for prop in ("protocol-services-supported", "protocol-object-types-supported"):
            dump["_" + prop] = _enc(await app.read_property(addr, devid, prop))
        now = json.loads(json.dumps(normalise(dump, instance), default=str))  # as the baseline reads back: lists, plain numbers
        path = os.path.join(BASELINES, f"{kind}.json")
        if update:
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(now, f, indent=1, sort_keys=True, ensure_ascii=False)
                f.write("\n")
            check(True, f"wrote baselines/{kind}.json ({len(dump) - 2} objects)")
        elif not os.path.isfile(path):
            check(False, f"no baselines/{kind}.json: run with --update from a known-good commit")
        else:
            with open(path, encoding="utf-8") as f:
                lines = diff(json.load(f), now)
            check(not lines, f"{len(dump) - 2} objects match baselines/{kind}.json", *(["\n         " + "\n         ".join(lines[:40])] if lines else []))
        bits = dump["_protocol-object-types-supported"]
        check({int(o[0]) for o in objs} == {i for i, b in enumerate(bits) if b}, "protocol-object-types-supported lists exactly its object types")

        # COV on every analog, binary and multi-state object
        control({"action": "speed", "value": 1})
        pts = {p["key"]: p for p in desc["points"]}
        covable = [k for k, p in pts.items() if p["type"].split("-")[0] in ("analog", "binary", "multi")]
        for k in covable:
            try:
                await app.request(SubscribeCOVRequest(subscriberProcessIdentifier=9, monitoredObjectIdentifier=oid(k), issueConfirmedNotifications=False, lifetime=900, destination=addr))
            except ErrorRejectAbortNack as e:
                check(False, "SubscribeCOV", k, e)
        await asyncio.sleep(2)
        missing = sorted(set(covable) - {o for o, _ in cov})
        check(not missing, f"SubscribeCOV and a first notification on all {len(covable)} analog, binary and multi-state objects", *missing)

        # write and relinquish at 8 on every writable point
        for k, p in pts.items():
            if not p["writable"]:
                continue
            v = p["value"]
            if v["type"] == "number":
                x = Real(round((v.get("min", 0) + v.get("max", 100)) / 2 + 0.5, 1))
            elif v["type"] == "integer":
                x = Unsigned(v["max"])
            else:
                x = Enumerated(1 if str(await rp(k, "present-value")) == "inactive" else 0)
            try:
                await app.write_property(addr, oid(k), "present-value", x, priority=8)
                await asyncio.sleep(1.2)
                pv, slot = await rp(k, "present-value"), (await rp(k, "priority-array"))[7]
                ok = slot.null is None and float(getattr(slot, slot._choice)) == float(x) and float(pv) == float(x)
                await app.write_property(addr, oid(k), "present-value", Null(()), priority=8)
                await asyncio.sleep(1.2)
                ok = ok and (await rp(k, "priority-array"))[7].null is not None
                check(ok, f"write {x} at 8 and relinquish: {p['name']} ({k})")
            except ErrorRejectAbortNack as e:
                check(False, f"write at 8: {p['name']} ({k})", e)
        ro = next(k for k, p in pts.items() if p["type"] == "analog-input")
        try:
            await app.write_property(addr, oid(ro), "present-value", Real(1.0))
            check(False, f"a write to an input in service ({ro}) was accepted")
        except ErrorRejectAbortNack as e:
            check("write-access-denied" in str(e), f"a write to an input in service ({ro}) is refused: {e}")

        # alarms, with the flags COV carries matching ReadProperty
        if kind not in SCENARIOS:
            check(False, f"no alarm SCENARIOS for {kind!r} in tests/bacnet.py")
        for actions, key in SCENARIOS.get(kind, []):
            cov.clear()
            for a in actions:
                control(a)
            state, until = "normal", time.time() + 300
            while time.time() < until:
                await asyncio.sleep(2)
                state = str(await rp(key, "event-state"))
                if state != "normal":
                    break
            control({"action": "speed", "value": 1})
            await asyncio.sleep(2)
            flags = list(await rp(key, "status-flags"))
            seen = [f for o, f in cov if o == key and f is not None]
            what = ", ".join(" ".join(str(x) for x in (a["action"], a.get("name"), a.get("value")) if x is not None) for a in actions)
            check(state != "normal" and flags[0] == 1, f"{key} alarms after {what}: {state}, flags {flags}")
            check(bool(seen) and seen[-1] == flags, f"{key}: the last COV notification carries the flags ReadProperty returns ({seen[-1:]} vs {flags})")
        summary = await app.request(GetAlarmSummaryRequest(destination=addr))
        check(True, "GetAlarmSummary:", ", ".join(f"{x.objectIdentifier} {x.alarmState}" for x in summary.listOfAlarmSummaries) or "none")

        # ReadRange by position, sequence number and time on every trend log
        for o in [o for o in objs if str(o[0]) in ("trend-log", "trend-log-multiple")]:
            a = await app.request(ReadRangeRequest(objectIdentifier=o, propertyIdentifier="log-buffer", range=Range(byPosition=RangeByPosition(referenceIndex=1, count=10)), destination=addr))
            b = await app.request(ReadRangeRequest(objectIdentifier=o, propertyIdentifier="log-buffer", range=Range(bySequenceNumber=RangeBySequenceNumber(referenceSequenceNumber=5, count=5)), destination=addr))
            lt = time.localtime(time.time() - 7200)
            ref = DateTime(date=Date((lt.tm_year - 1900, lt.tm_mon, lt.tm_mday, lt.tm_wday + 1)), time=Time((lt.tm_hour, lt.tm_min, lt.tm_sec, 0)))
            c = await app.request(ReadRangeRequest(objectIdentifier=o, propertyIdentifier="log-buffer", range=Range(byTime=RangeByTime(referenceTime=ref, count=100)), destination=addr))
            n = await app.read_property(addr, o, "record-count")
            check(n > 250 and a.itemCount == 10 and b.itemCount == 5 and b.firstSequenceNumber == 5 and c.itemCount >= 8,
                  f"ReadRange {o}: {n} records; by position {a.itemCount}, by sequence {b.itemCount}, last two hours {c.itemCount}")

        iams.clear()
        control({"action": "storm", "value": 3})
        await asyncio.sleep(4)
        check(iams.count(f"device,{instance}") >= 20, f"I-Am storm heard here: {iams.count(f'device,{instance}')} I-Ams in 3 s")

        bad = [a for a in http(base, "GET", f"/api/d/{instance}/state")["activity"] if "Tick failed" in a["detail"] or a["service"] == "Error"]
        check(not bad, "no errors in the activity log", *bad[:3])
    finally:
        app.close()
    return 1 if fails else 0


# ---- the run: an isolated Rasher, a device of each type, a worker per device ----------------------------------------


def free_tcp(port: int) -> bool:
    with socket.socket() as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def free_udp(start: int, taken: set) -> int:
    port = start
    while True:
        if port not in taken:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                try:
                    s.bind(("", port))
                    return port
                except OSError:
                    pass
        port += 1


@contextlib.contextmanager
def isolated(http_port: int = 8049, types: list[str] | None = None, instance: int = 4101, adapter: str | None = None):
    """A Rasher of its own, on its own HTTP port with its settings in a temporary folder, with one device of each
    type (or of each listed) on this PC's address. Yields (base url, devices); stops it afterwards."""
    if not free_tcp(http_port):
        raise SystemExit(f"Port {http_port} is in use; pick another with --http.")
    base = f"http://127.0.0.1:{http_port}"
    home = tempfile.mkdtemp(prefix="rasher-tests-")
    src = os.path.join(os.path.dirname(HERE), "src")
    env = {**os.environ, "PYTHONPATH": src + os.pathsep + os.environ.get("PYTHONPATH", ""), "RASHER_PORT": str(http_port), "LOCALAPPDATA": home}
    log = open(os.path.join(home, "rasher.out"), "w")
    server = subprocess.Popen([sys.executable, "-m", "rasher", "--no-browser"], env=env, stdout=log, stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            try:
                http(base, "GET", "/api/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        setup = http(base, "GET", "/api/setup")
        types = types or [p["type"] for p in setup["profiles"]]
        adapter = adapter or next((x["name"] for x in setup["adapters"] if x["up"] and not x["ip"].startswith("127.")), None)
        if not adapter:
            raise SystemExit("No network adapter with an IPv4 address is up.")
        port = free_udp(47830, set())
        http(base, "POST", "/api/start", {"adapter": adapter, "mode": "own", "port": port, "instance": instance,
                                             "prefix": next(p["prefix"] for p in setup["profiles"] if p["type"] == types[0]), "type": types[0]})
        if types[1:]:
            http(base, "POST", "/api/devices", {"devices": [{"type": t, "count": 1} for t in types[1:]]})
        devices = http(base, "GET", "/api/devices")
        print(f"Rasher on {base} ({adapter}): " + ", ".join(f"{d['name']} ({d['type']}) on {d['port']}" for d in devices), flush=True)
        yield base, devices
    finally:
        server.terminate()
        server.wait(10)
        log.close()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--types", nargs="*", help="profile types to check (default: all)")
    ap.add_argument("--update", action="store_true", help="write the baselines from this run instead of comparing")
    ap.add_argument("--http", type=int, default=8049, help="Rasher's HTTP port for the run (default 8049)")
    ap.add_argument("--adapter", help="network adapter to use (default: the first one that's up)")
    ap.add_argument("--instance", type=int, default=4101, help="first device instance (default 4101)")
    ap.add_argument("_worker", nargs="*", help=argparse.SUPPRESS)
    a = ap.parse_args()
    if a._worker:  # worker: base instance clientport update
        return asyncio.run(check_device(a._worker[0], int(a._worker[1]), int(a._worker[2]), a._worker[3] == "1"))

    with isolated(a.http, a.types, a.instance, a.adapter) as (base, devices):
        taken = {d["port"] for d in devices}
        workers = []
        for d in devices:
            cport = free_udp(47990, taken)
            taken.add(cport)
            workers.append((d["instance"], subprocess.Popen([sys.executable, __file__, base, str(d["instance"]), str(cport), "1" if a.update else "0"])))
        codes = [(inst, w.wait()) for inst, w in workers]
    failed = [inst for inst, c in codes if c]
    print(f"\n{'FAILED: ' + ', '.join(map(str, failed)) if failed else 'All checks passed'} ({len(codes)} devices)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
