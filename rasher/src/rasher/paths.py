"""Where Rasher keeps its files: %LOCALAPPDATA%/Rasher (settings, the addresses it added, the window's storage)."""

import os


def data_dir(*parts: str) -> str:
    base = os.environ.get("LOCALAPPDATA") or os.path.join(os.path.expanduser("~"), ".local", "share")
    path = os.path.join(base, "Rasher", *parts)
    os.makedirs(path, exist_ok=True)
    return path
