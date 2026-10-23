"""Where BACon keeps its files: %LOCALAPPDATA%/BACon (trend recordings, network captures, updates)."""

import os
import time

KEEP_DAYS = 30


def data_dir(*parts: str) -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
    path = os.path.join(base, "BACon", *parts)
    os.makedirs(path, exist_ok=True)
    return path


def clean_old(folder: str, days: int = KEEP_DAYS):
    """Delete recordings and captures older than `days`, so the folder never grows without end."""
    cutoff = time.time() - days * 86400
    try:
        for name in os.listdir(folder):
            path = os.path.join(folder, name)
            try:
                if os.path.isfile(path) and os.path.getmtime(path) < cutoff:
                    os.remove(path)
            except OSError:
                pass  # in use or already gone
    except OSError:
        pass
