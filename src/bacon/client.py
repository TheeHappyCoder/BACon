"""BACnet/IP client: discovery and read-everything-from-a-device.

Read-only: nothing in here ever writes to a device.

Reading an object tries, in order:
  1. ReadPropertyMultiple(ALL)
  2. property-list, then ReadPropertyMultiple in small chunks
  3. a candidate list (the standard properties for the object type plus every
     proprietary property already seen on this device), in small chunks
and any chunk that fails is retried one property at a time. "unknown-property"
replies just mean the object does not have that property, so they are dropped
rather than reported as errors.
"""

import asyncio
import socket
import time
from dataclasses import dataclass, field

from bacpypes3.apdu import (
    ErrorRejectAbortNack,
    ReadPropertyMultipleRequest,
    ReadPropertyRequest,
)
from bacpypes3.argparse import SimpleArgumentParser
from bacpypes3.app import Application
from bacpypes3.basetypes import PropertyReference, ReadAccessSpecification
from bacpypes3.pdu import Address
from bacpypes3.primitivedata import ObjectIdentifier, PropertyIdentifier, TagClass
from bacpypes3.vendor import get_vendor_info

from .decode import decode_value, object_ids_from_any, object_type_name
from .names import property_label

PROP_ALL = 8
PROP_OBJECT_LIST = 76
PROP_PROPERTY_LIST = 371
CHUNK = 8
OWN_INSTANCE = 4194301  # our own (hidden) BACnet device id
PARALLEL_OBJECTS = 4
SILENT_LIMIT = 6  # this many no-response objects in a row means the device is gone

# synthetic columns added to every object row
COL_DEVICE = "Device"
COL_DEVICE_NAME = "Device name"
COL_TYPE = "Object type"
COL_INSTANCE = "Instance"
COL_STATUS = "Read status"

BACnetError = (Exception, ErrorRejectAbortNack)


class ConnectError(Exception):
    pass


def error_text(err) -> str:
    code = getattr(err, "errorCode", None)
    if code is not None:
        return str(code)
    for attr in ("apduAbortRejectReason", "apduReason", "reason"):
        reason = getattr(err, attr, None)
        if reason is not None:
            kind = type(err).__name__.replace("PDU", "").lower()
            return f"{kind}: {reason}"
    if isinstance(err, asyncio.TimeoutError):
        return "timeout"
    text = str(err) or type(err).__name__
    return text[:200]


def _is_unknown_property(text: str) -> bool:
    return text in ("unknown-property", "unknownProperty")


def _enums_from_any(anyval) -> list[int]:
    return [
        int.from_bytes(bytes(t.tag_data), "big")
        for t in anyval.tagList
        if t.tag_class == TagClass.application and t.tag_number == 9
    ]


def _class_property_ids(obj_class) -> list[int]:
    if obj_class is None:
        return []
    elements = obj_class._elements
    names = elements.keys() if isinstance(elements, dict) else [
        e if isinstance(e, str) else e[0] for e in elements
    ]
    ids = []
    for name in names:
        hyphenated = "".join("-" + c.lower() if c.isupper() else c for c in name)
        for candidate in (name, hyphenated):
            try:
                ids.append(int(PropertyIdentifier(candidate)))
                break
            except Exception:
                continue
    return ids


@dataclass
class Device:
    instance: int
    address: str
    vendor_id: int | None = None
    name: str = ""
    vendor_name: str = ""
    model: str = ""
    firmware: str = ""
    description: str = ""
    info_error: str = ""
    no_rpm: bool = False
    seen_props: set = field(default_factory=set)
    saved_at: str = ""  # set when the device came from a saved site file rather than the network

    def to_json(self):
        return {
            "savedAt": self.saved_at,
            "instance": self.instance,
            "address": self.address,
            "vendorId": self.vendor_id,
            "name": self.name,
            "vendorName": self.vendor_name,
            "model": self.model,
            "firmware": self.firmware,
            "description": self.description,
            "infoError": self.info_error,
        }

    def to_file(self) -> dict:
        data = self.to_json()
        data["seenProps"] = sorted(self.seen_props)
        return data

    @classmethod
    def from_file(cls, data: dict, saved_at: str) -> "Device":
        return cls(
            instance=int(data["instance"]),
            address=str(data.get("address", "")),
            vendor_id=data.get("vendorId"),
            name=data.get("name", ""),
            vendor_name=data.get("vendorName", ""),
            model=data.get("model", ""),
            firmware=data.get("firmware", ""),
            description=data.get("description", ""),
            info_error=data.get("infoError", ""),
            seen_props=set(data.get("seenProps", [])),
            saved_at=saved_at,
        )


def check_port_free(ip: str, port: int):
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.bind((ip, port))
    except OSError as e:
        if getattr(e, "winerror", None) == 10049 or e.errno == 99:  # address not available
            raise ConnectError(
                f"{ip} is not an address on this PC any more - the cable may be unplugged "
                f"or the adapter changed address. Refresh the adapter list and pick again."
            )
        raise ConnectError(
            f"UDP port {port} on {ip} is already in use - another BACnet tool (YABE, "
            f"Desigo, a simulator) is probably running. Close it, or connect on a "
            f"different port (e.g. 47809; scanning then only finds devices that reply directly)."
        )
    finally:
        sock.close()


class BacnetClient:
    def __init__(self):
        self.app: Application | None = None
        self.settings: dict | None = None

    # ---- connection ----------------------------------------------------

    def connect(self, ip: str, prefix: int, port: int = 47808, bbmd: str | None = None, ttl: int = 900):
        self.close()
        check_port_free(ip, port)
        argv = [
            "--address", f"{ip}/{prefix}:{port}",
            "--instance", str(OWN_INSTANCE),
            "--name", "BACnet-Exporter",
        ]
        if bbmd:
            argv += ["--foreign", bbmd, "--ttl", str(ttl)]
        args = SimpleArgumentParser().parse_args(argv)
        try:
            self.app = Application.from_args(args)
        except Exception as e:
            raise ConnectError(f"Could not start BACnet on {ip}:{port}: {e}")
        self.settings = {"ip": ip, "prefix": prefix, "port": port, "bbmd": bbmd or ""}

    def close(self):
        if self.app is not None:
            try:
                self.app.close()
            except Exception:
                pass
        self.app = None
        self.settings = None

    def _require(self) -> Application:
        if self.app is None:
            raise ConnectError("Not connected - pick a network adapter and connect first.")
        return self.app

    # ---- low level -----------------------------------------------------

    async def rpm(self, address: str, oid: ObjectIdentifier, pids: list[int]):
        """ReadPropertyMultiple -> {pid: ("ok", Any) | ("err", text)}. Raises on whole-request failure."""
        app = self._require()
        request = ReadPropertyMultipleRequest(
            listOfReadAccessSpecs=[
                ReadAccessSpecification(
                    objectIdentifier=oid,
                    listOfPropertyReferences=[PropertyReference(propertyIdentifier=p) for p in pids],
                )
            ],
            destination=Address(address),
        )
        ack = await app.request(request)
        out = {}
        for result in ack.listOfReadAccessResults:
            for element in result.listOfResults:
                pid = int(element.propertyIdentifier)
                rr = element.readResult
                if rr.propertyValue is not None:
                    out[pid] = ("ok", rr.propertyValue)
                else:
                    out[pid] = ("err", error_text(rr.propertyAccessError))
        return out

    async def rp(self, address: str, oid: ObjectIdentifier, pid: int, index: int | None = None):
        app = self._require()
        request = ReadPropertyRequest(
            objectIdentifier=oid, propertyIdentifier=pid, destination=Address(address)
        )
        if index is not None:
            request.propertyArrayIndex = index
        ack = await app.request(request)
        return ack.propertyValue

    async def read_props(self, device: Device, oid: ObjectIdentifier, pids: list[int]):
        """Read a list of properties as robustly as possible -> {pid: ("ok", Any) | ("err", text)}."""
        out = {}
        if not device.no_rpm:
            for i in range(0, len(pids), CHUNK):
                chunk = pids[i : i + CHUNK]
                try:
                    out.update(await self.rpm(device.address, oid, chunk))
                    continue
                except BACnetError as e:
                    if "unrecognized-service" in error_text(e):
                        device.no_rpm = True
                for pid in chunk:
                    out[pid] = await self._rp_result(device, oid, pid)
        else:
            for pid in pids:
                out[pid] = await self._rp_result(device, oid, pid)
        return out

    async def _rp_result(self, device, oid, pid):
        try:
            return ("ok", await self.rp(device.address, oid, pid))
        except BACnetError as e:
            return ("err", error_text(e))

    # ---- discovery -----------------------------------------------------

    async def scan(self, low: int | None = None, high: int | None = None, timeout: float = 3.0, target: str | None = None):
        app = self._require()
        i_ams = await app.who_is(low, high, Address(target) if target else None, timeout)
        devices, seen = [], set()
        for i_am in i_ams:
            inst = i_am.iAmDeviceIdentifier[1]
            if inst in seen or inst == OWN_INSTANCE:
                continue
            seen.add(inst)
            devices.append(Device(instance=inst, address=str(i_am.pduSource), vendor_id=int(i_am.vendorID)))
        await asyncio.gather(*(self.fill_device_info(d) for d in devices))
        return devices

    async def add_by_address(self, address: str):
        """Find a device at a known IP (also works across routers, where broadcasts don't reach)."""
        address = address.strip()
        found = await self.scan(target=address, timeout=3.0)
        if found:
            return found[0]
        # no I-Am came back - ask the device object directly using the wildcard instance
        try:
            value = await self.rp(address, ObjectIdentifier((8, 4194303)), 75)
        except BACnetError as e:
            reason = error_text(e)
            if "no-response" in reason:
                raise ConnectError(
                    f"No BACnet device answered at {address}. Check the address, and that the device "
                    f"is online and reachable on UDP 47808."
                )
            raise ConnectError(f"The device at {address} refused the request ({reason}).")
        ids = object_ids_from_any(value)
        if not ids:
            raise ConnectError(f"Device at {address} answered but returned no device identifier.")
        if ids[0][1] == OWN_INSTANCE:
            raise ConnectError(f"{address} is this PC - enter the controller's IP instead.")
        device = Device(instance=ids[0][1], address=address)
        await self.fill_device_info(device)
        return device

    async def fill_device_info(self, device: Device):
        oid = ObjectIdentifier((8, device.instance))
        wanted = {77: "name", 121: "vendor_name", 70: "model", 44: "firmware", 28: "description"}
        try:
            res = await self.read_props(device, oid, list(wanted) + [120])
        except BACnetError as e:
            device.info_error = error_text(e)
            return
        cls = get_vendor_info(0).get_object_class(8)
        for pid, attr in wanted.items():
            kind, val = res.get(pid, ("err", "missing"))
            if kind == "ok":
                setattr(device, attr, decode_value(cls, pid, val))
        kind, val = res.get(120, ("err", ""))
        if kind == "ok" and device.vendor_id is None:
            try:
                device.vendor_id = int(decode_value(cls, 120, val))
            except ValueError:
                pass
        if all(res.get(pid, ("err",))[0] == "err" for pid in wanted):
            device.info_error = res.get(77, ("err", "no response"))[1]

    # ---- reading everything ---------------------------------------------

    async def object_list(self, device: Device) -> list[tuple[int, int]]:
        oid = ObjectIdentifier((8, device.instance))
        try:
            ids = object_ids_from_any(await self.rp(device.address, oid, PROP_OBJECT_LIST))
            if ids:
                return ids
        except BACnetError:
            pass
        # too big for one response (and no segmentation): read it entry by entry
        count_any = await self.rp(device.address, oid, PROP_OBJECT_LIST, index=0)
        count = int(_enums_or_unsigned(count_any))
        ids = []
        for i in range(1, count + 1):
            try:
                ids += object_ids_from_any(await self.rp(device.address, oid, PROP_OBJECT_LIST, index=i))
            except BACnetError:
                continue
        return ids

    async def read_object(self, device: Device, type_id: int, instance: int) -> dict:
        oid = ObjectIdentifier((type_id, instance))
        obj_class = get_vendor_info(0).get_object_class(type_id) if type_id < 128 else None
        results = None
        first_error = ""

        if not device.no_rpm:
            try:
                results = await self.rpm(device.address, oid, [PROP_ALL])
            except BACnetError as e:
                first_error = error_text(e)
                if "unrecognized-service" in first_error:
                    device.no_rpm = True

        if results is None:
            pids = None
            try:
                pids = _enums_from_any(await self.rp(device.address, oid, PROP_PROPERTY_LIST)) or None
            except BACnetError:
                pass
            if pids is None:
                pids = _class_property_ids(obj_class) + sorted(device.seen_props)
            pids = list(dict.fromkeys([75, 77, 79, 28] + pids))
            pids = [p for p in pids if p not in (PROP_ALL, PROP_PROPERTY_LIST)]
            results = await self.read_props(device, oid, pids)

        values, errors = {}, {}
        for pid, (kind, val) in results.items():
            if pid in (PROP_ALL, PROP_PROPERTY_LIST):
                continue
            label = property_label(pid, device.vendor_id)
            if kind == "ok":
                if pid >= 512:
                    device.seen_props.add(pid)
                try:
                    values[label] = decode_value(obj_class, pid, val)
                except Exception as e:
                    errors[label] = f"decode failed: {e}"
            elif not _is_unknown_property(val):
                errors[label] = val

        if not values:
            reason = first_error or next(iter(errors.values()), "no response")
            status = f"failed: {reason}"
        elif errors:
            status = f"partial: {len(errors)} propert{'y' if len(errors) == 1 else 'ies'} unreadable"
        else:
            status = "ok"

        values.update({
            COL_DEVICE: str(device.instance),
            COL_DEVICE_NAME: device.name,
            COL_TYPE: object_type_name(type_id),
            COL_INSTANCE: str(instance),
            COL_STATUS: status,
        })
        return {
            "key": f"{device.instance}:{type_id},{instance}",
            "device": device.instance,
            "typeId": type_id,
            "instance": instance,
            "status": "ok" if status == "ok" else status.split(":")[0],
            "values": values,
            "errors": errors,
        }

    async def read_device(self, device: Device, on_progress, only: list[tuple[int, int]] | None = None):
        """Read every object (or just `only`). on_progress(done, total, obj_result) is called per object."""
        ids = only if only is not None else await self.object_list(device)
        if not only and (8, device.instance) not in ids:
            ids = [(8, device.instance)] + ids
        # standard I/O-style objects first, so proprietary property ids are known
        # by the time we hit the big or proprietary objects that need the fallback
        ids = sorted(ids, key=lambda t: (t[0] == 8 or t[0] >= 128))
        total, done = len(ids), 0
        on_progress(0, total, None)
        sem = asyncio.Semaphore(PARALLEL_OBJECTS)
        # stop early if the device goes quiet, instead of waiting out a timeout per object
        silent, gave_up = 0, False

        def skipped(type_id, inst):
            return {
                "key": f"{device.instance}:{type_id},{inst}",
                "device": device.instance, "typeId": type_id, "instance": inst,
                "status": "failed",
                "values": {
                    COL_DEVICE: str(device.instance), COL_DEVICE_NAME: device.name,
                    COL_TYPE: object_type_name(type_id), COL_INSTANCE: str(inst),
                    COL_STATUS: "failed: skipped, the device stopped responding",
                },
                "errors": {},
            }

        async def one(type_id, inst):
            nonlocal done, silent, gave_up
            async with sem:
                if gave_up:
                    done += 1
                    on_progress(done, total, skipped(type_id, inst))
                    return
                try:
                    result = await self.read_object(device, type_id, inst)
                except BACnetError as e:
                    result = {
                        "key": f"{device.instance}:{type_id},{inst}",
                        "device": device.instance, "typeId": type_id, "instance": inst,
                        "status": "failed",
                        "values": {
                            COL_DEVICE: str(device.instance), COL_DEVICE_NAME: device.name,
                            COL_TYPE: object_type_name(type_id), COL_INSTANCE: str(inst),
                            COL_STATUS: f"failed: {error_text(e)}",
                        },
                        "errors": {},
                    }
                if result["status"] == "failed" and "no-response" in result["values"][COL_STATUS]:
                    silent += 1
                    if silent >= SILENT_LIMIT:
                        gave_up = True
                else:
                    silent = 0
                done += 1
                on_progress(done, total, result)

        regular = [t for t in ids if not (t[0] == 8 or t[0] >= 128)]
        special = [t for t in ids if t[0] == 8 or t[0] >= 128]
        await asyncio.gather(*(one(*t) for t in regular))
        await asyncio.gather(*(one(*t) for t in special))
        if gave_up:
            raise ConnectError(
                "The device stopped responding, so the remaining objects were skipped. "
                "Check it is online, then use Retry."
            )


def _enums_or_unsigned(anyval) -> int:
    for t in anyval.tagList:
        if t.tag_class == TagClass.application and t.tag_number in (2, 9):
            return int.from_bytes(bytes(t.tag_data), "big")
    raise ValueError("no count in object-list[0]")
