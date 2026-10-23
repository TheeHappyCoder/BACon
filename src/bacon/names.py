"""Property names: standard names from bacpypes3, vendor-specific names from
the vendor property mapping CSV (same format as YABE's VendorPropertyMapping.csv)."""

import csv
import os
from functools import lru_cache

from bacpypes3.primitivedata import PropertyIdentifier

YABE_MAPPING = r"C:\Program Files\Yabe\VendorPropertyMapping.csv"


def _bundled_path() -> str:
    return os.path.join(os.path.dirname(__file__), "data", "vendor_properties.csv")


@lru_cache(maxsize=1)
def _vendor_map() -> dict[tuple[int, int], str]:
    mapping: dict[tuple[int, int], str] = {}
    # bundled copy first, then a local YABE install (newer) overrides it
    for path in (_bundled_path(), YABE_MAPPING):
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for row in csv.reader(f):
                    if len(row) >= 3 and row[0].strip().isdigit() and row[1].strip().isdigit():
                        mapping[(int(row[0]), int(row[1]))] = row[2].strip()
        except OSError:
            pass
    return mapping


def property_label(prop_id: int, vendor_id: int | None) -> str:
    """Column label for a property. Proprietary ids are only meaningful per vendor."""
    if prop_id < 512:
        try:
            return str(PropertyIdentifier(prop_id))
        except Exception:
            return f"property-{prop_id}"
    name = _vendor_map().get((vendor_id, prop_id)) if vendor_id is not None else None
    if name:
        return f"{name} [{prop_id}]"
    return f"proprietary [{prop_id}]" if vendor_id is None else f"proprietary v{vendor_id} [{prop_id}]"
