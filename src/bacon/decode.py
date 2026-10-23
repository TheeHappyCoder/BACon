"""Turn BACnet property values into plain display strings.

Standard properties on standard object types are decoded with bacpypes3's
datatypes (so enumerations show as names). Anything else - proprietary
properties, proprietary object types, or values that fail to cast - falls
back to a generic tag-by-tag decoder, so every value still shows something
readable.
"""

import struct

from bacpypes3.constructeddata import Any, Choice
from bacpypes3.primitivedata import BitString, Boolean, Null, ObjectIdentifier, ObjectType, OctetString, TagClass


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


def fmt(value) -> str:
    """Format a decoded bacpypes3 value as a plain string."""
    if value is None:
        return ""
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
