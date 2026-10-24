"""Turn BACnet property values into plain display strings.

Standard properties on standard object types are decoded with bacpypes3's
datatypes (so enumerations show as names). Anything else - proprietary
properties, proprietary object types, or values that fail to cast - falls
back to a generic tag-by-tag decoder, so every value still shows something
readable.
"""

import struct

from bacpypes3.constructeddata import Any, AnyAtomic, Choice
from bacpypes3.basetypes import DateTime
from bacpypes3.primitivedata import (
    BitString,
    Boolean,
    CharacterString,
    Date,
    Double,
    Enumerated,
    Integer,
    Null,
    ObjectIdentifier,
    ObjectType,
    OctetString,
    Real,
    TagClass,
    Time,
    Unsigned,
)


def _dec_str(data: bytes) -> str:
    if not data:
        return ""
    charset, body = data[0], data[1:]
    if charset in (1, 4):  # DBCS / UCS-2
        return body.decode("utf-16-be", "replace")
    if charset == 5:  # UCS-4
        return body.decode("utf-32-be", "replace")
    return body.decode("utf-8" if charset == 0 else "latin-1", "replace")


def _num(v: float) -> str:
    return f"{v:.7g}"


def _dec_tag(tag) -> str:
    data = bytes(tag.tag_data)
    if tag.tag_class != TagClass.application:
        return f"[{tag.tag_number}]{data.hex()}"
    n = tag.tag_number
    try:
        if n == 0:
            return "null"
        if n == 1:
            return "true" if tag.tag_lvt else "false"
        if n == 2:
            return str(int.from_bytes(data, "big"))
        if n == 3:
            return str(int.from_bytes(data, "big", signed=True))
        if n == 4:
            return _num(struct.unpack(">f", data)[0])
        if n == 5:
            return _num(struct.unpack(">d", data)[0])
        if n == 6:
            return data.hex()
        if n == 7:
            return _dec_str(data)
        if n == 8:
            if not data:
                return ""
            bits = "".join(f"{b:08b}" for b in data[1:])
            return bits[: len(bits) - data[0]]
        if n == 9:
            return str(int.from_bytes(data, "big"))
        if n == 10:
            y, m, d, _ = data
            return f"{'*' if y == 255 else y + 1900}-{'*' if m == 255 else m:>02}-{'*' if d == 255 else d:>02}"
        if n == 11:
            return ":".join("*" if x == 255 else f"{x:02d}" for x in data[:3]) + (
                "" if data[3] == 255 else f".{data[3]:02d}"
            )
        if n == 12:
            v = int.from_bytes(data, "big")
            return f"{object_type_name(v >> 22)},{v & 0x3FFFFF}"
    except Exception:
        pass
    return data.hex()


def decode_any_raw(anyval) -> str:
    # build a nested list from opening/closing tags, then render it
    root: list = []
    stack = [root]
    for tag in anyval.tagList:
        if tag.tag_class == TagClass.opening:
            child: list = []
            stack[-1].append(child)
            stack.append(child)
        elif tag.tag_class == TagClass.closing:
            if len(stack) > 1:
                stack.pop()
        else:
            stack[-1].append(_dec_tag(tag))

    # unwrap the property-value envelope ({ ... } around the whole value)
    while len(root) == 1 and isinstance(root[0], list):
        root = root[0]

    def render(items, top=False):
        out = [("{" + render(x) + "}") if isinstance(x, list) else x for x in items]
        return ("; " if top else " ").join(out)

    return render(root, top=True)


def object_ids_from_any(anyval) -> list[tuple[int, int]]:
    """Pull every object identifier out of a value (used for object-list)."""
    out = []
    for tag in anyval.tagList:
        if tag.tag_class == TagClass.application and tag.tag_number == 12:
            v = int.from_bytes(bytes(tag.tag_data), "big")
            out.append((v >> 22, v & 0x3FFFFF))
    return out


def fmt_date(d) -> str:
    y, m, day, _ = tuple(d)
    if y == m == day == 255:
        return "any date"
    month = {13: "odd", 14: "even"}.get(m, "*" if m == 255 else f"{m:02d}")
    dom = {32: "last", 33: "odd", 34: "even"}.get(day, "*" if day == 255 else f"{day:02d}")
    return f"{'*' if y == 255 else y + 1900}-{month}-{dom}"


def fmt_time(t) -> str:
    h, m, sec, _ = tuple(t)
    if h == m == sec == 255:
        return "any time"
    return ":".join("*" if x == 255 else f"{x:02d}" for x in (h, m, sec))


def fmt(value) -> str:
    """Format a decoded bacpypes3 value as a plain string."""
    if value is None:
        return ""
    if isinstance(value, Date):
        return fmt_date(value)
    if isinstance(value, Time):
        return fmt_time(value)
    if isinstance(value, DateTime):
        if all(x == 255 for x in tuple(value.date) + tuple(value.time)):
            return "never"
        return f"{fmt_date(value.date)} {fmt_time(value.time)}"
    if isinstance(value, (bool, Boolean)):
        return "true" if int(value) else "false"
    if isinstance(value, float):
        return _num(value)
    if isinstance(value, Any):
        return decode_any_raw(value)
    if isinstance(value, Null):
        return "null"
    if isinstance(value, ObjectIdentifier):
        return str(value)
    if isinstance(value, (OctetString, bytes)):
        return bytes(value).hex()
    if isinstance(value, Choice):  # e.g. priority-array slots: show only the chosen value
        names = value._elements.keys() if isinstance(value._elements, dict) else [
            e if isinstance(e, str) else e[0] for e in value._elements
        ]
        for name in names:
            x = getattr(value, name, None)
            if x is not None:
                return fmt(x)
        return ""
    if isinstance(value, BitString):  # flags: names of the set bits
        return str(value) or "none"
    if isinstance(value, (str, int)):
        return str(value)
    if isinstance(value, (list, tuple)):
        return "; ".join(fmt(x) for x in value)
    elements = getattr(value, "_elements", None)
    if elements:
        names = elements.keys() if isinstance(elements, dict) else [
            e if isinstance(e, str) else e[0] for e in elements
        ]
        parts = []
        for name in names:
            x = getattr(value, name, None)
            if x is not None:
                parts.append(f"{name}={fmt(x)}")
        return "{" + ", ".join(parts) + "}"
    if hasattr(value, "value") and isinstance(getattr(value, "value"), list):  # arrays/lists
        return "; ".join(fmt(x) for x in value.value)
    try:
        return str(value)
    except Exception:
        return repr(value)


def decode_value(obj_class, prop_id: int, anyval) -> str:
    if obj_class is not None and prop_id < 512:
        try:
            datatype = obj_class.get_property_type(prop_id)
            if datatype is not None:
                return fmt(anyval.cast_out(datatype))
        except Exception:
            pass
    return decode_any_raw(anyval)


def object_type_name(type_id: int) -> str:
    if type_id < 128:
        try:
            return str(ObjectType(type_id))
        except Exception:
            pass
    return f"type-{type_id}"


# ---- structured values, for the screens that need more than a display string ----------------------------------------

# property ids whose value is also kept as JSON on the object row ("detail"), keyed by the property's label
STRUCTURED = {
    23: "date-list",
    32: "effective-period",
    38: "exception-schedule",
    54: "list-of-object-property-references",
    123: "weekly-schedule",
    130: "event-time-stamps",
    132: "log-device-object-property",
    174: "schedule-default",
}


def _date_json(d):
    """[year, month, day, weekday] with None for a wildcard (month 13/14 odd/even, day 32/33/34 last/odd/even)."""
    y, m, day, dow = tuple(d)
    return [None if y == 255 else y + 1900, None if m == 255 else m, None if day == 255 else day, None if dow == 255 else dow]


def _time_json(t):
    h, m, sec, _ = tuple(t)
    if h == 255:
        return None
    return f"{h:02d}:{0 if m == 255 else m:02d}:{0 if sec == 255 else sec:02d}"


def value_json(v):
    """An atomic value (schedule entries, schedule-default) as {type, value}."""
    if isinstance(v, AnyAtomic):
        try:
            v = v.get_value()
        except Exception:
            return {"type": "other", "value": decode_any_raw(v)}
    if v is None or isinstance(v, Null):
        return {"type": "null", "value": None}
    if isinstance(v, (Boolean, bool)):
        return {"type": "boolean", "value": bool(int(v))}
    if isinstance(v, Enumerated):
        return {"type": "enumerated", "value": int(v)}
    if isinstance(v, Unsigned):
        return {"type": "unsigned", "value": int(v)}
    if isinstance(v, Integer):
        return {"type": "integer", "value": int(v)}
    if isinstance(v, (Real, Double, float)):
        return {"type": "real", "value": float(f"{float(v):.7g}")}
    if isinstance(v, CharacterString):
        return {"type": "string", "value": str(v)}
    if isinstance(v, int):
        return {"type": "unsigned", "value": int(v)}
    return {"type": "other", "value": fmt(v)}


def _calendar_entry_json(e):
    if e.date is not None:
        return {"date": _date_json(e.date)}
    if e.dateRange is not None:
        return {"range": [_date_json(e.dateRange.startDate), _date_json(e.dateRange.endDate)]}
    if e.weekNDay is not None:
        return {"weekNDay": [None if x == 255 else x for x in bytes(e.weekNDay)[:3]]}
    return None


def _times_json(items):
    return [{"time": _time_json(x.time), "value": value_json(x.value)} for x in (items or [])]


def _ref_json(r):
    oid = r.objectIdentifier
    dev = getattr(r, "deviceIdentifier", None)
    return {
        "object": [int(oid[0]), int(oid[1])],
        "property": str(r.propertyIdentifier),
        "device": int(dev[1]) if dev is not None else None,
    }


def stamp_json(s):
    """An event time stamp as a local ISO date-time, {"time"} or {"sequence"}; None when it never happened."""
    if s is None:
        return None
    if s.dateTime is not None:
        d, t = tuple(s.dateTime.date), tuple(s.dateTime.time)
        if d[0] == 255 or d[1] == 255 or d[2] == 255 or t[0] == 255:
            return None
        return f"{d[0] + 1900:04d}-{d[1]:02d}-{d[2]:02d}T{t[0]:02d}:{t[1] % 255:02d}:{t[2] % 255:02d}"
    if s.time is not None:
        return None if tuple(s.time)[0] == 255 else {"time": _time_json(s.time)}
    if s.sequenceNumber is not None:
        return {"sequence": int(s.sequenceNumber)}
    return None


def structured(obj_class, prop_id: int, anyval):
    """JSON for the properties in STRUCTURED, or None when the value does not decode as the standard says."""
    if obj_class is None or prop_id not in STRUCTURED:
        return None
    try:
        datatype = obj_class.get_property_type(prop_id)
        if datatype is None:
            return None
        v = anyval.cast_out(datatype)
        if prop_id == 123:
            return [_times_json(day.daySchedule) for day in v]
        if prop_id == 38:
            out = []
            for ev in v:
                p = ev.period
                if p.calendarReference is not None:
                    period = {"calendar": [int(p.calendarReference[0]), int(p.calendarReference[1])]}
                else:
                    period = _calendar_entry_json(p.calendarEntry)
                out.append({"period": period, "times": _times_json(ev.listOfTimeValues), "priority": int(ev.eventPriority)})
            return out
        if prop_id == 32:
            return [_date_json(v.startDate), _date_json(v.endDate)]
        if prop_id == 23:
            return [x for x in (_calendar_entry_json(e) for e in v) if x is not None]
        if prop_id == 174:
            return value_json(v)
        if prop_id in (54, 132):
            items = [v] if hasattr(v, "objectIdentifier") else list(v)
            return [_ref_json(r) for r in items]
        if prop_id == 130:
            return [stamp_json(s) for s in v]
    except Exception:
        return None
    return None
