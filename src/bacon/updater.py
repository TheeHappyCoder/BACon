"""Self-update from GitHub Releases.

A release is tagged vX.Y.Z and carries two assets: BACon.exe and BACon.exe.sha256. The app checks the latest release,
downloads the exe next to its data, checks the SHA-256, then hands over to a tiny batch script that waits for this
process to exit, swaps the exe and starts it again. Only the packaged exe updates itself; running from source just
reports what is available.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

from .paths import data_dir
from .version import REPO, __version__

# the repo also carries Rasher's releases (tagged rasher-vX.Y.Z), so never ask for GitHub's "latest": list them and pick ours
API = f"https://api.github.com/repos/{REPO}/releases?per_page=50"
EXE = "BACon.exe"
TAG = re.compile(r"v\d+\.\d+\.\d+")
CHECK_EVERY = 6 * 3600  # seconds; the UI asks on boot, this only stops repeat calls hammering GitHub

FROZEN = bool(getattr(sys, "frozen", False))


def _parse(tag: str) -> tuple[int, ...]:
    parts = []
    for p in tag.lstrip("vV").split("."):
        digits = "".join(c for c in p if c.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts + [0] * (3 - len(parts)))


def _get(url: str, timeout: float = 10) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": f"BACon/{__version__}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def pick_release(releases: list) -> dict | None:
    """The newest published BACon release: the highest vX.Y.Z tag with BACon.exe on it."""
    ours = [
        r for r in releases
        if not r.get("draft") and not r.get("prerelease") and TAG.fullmatch(r.get("tag_name") or "")
        and any(a.get("name") == EXE for a in r.get("assets") or [])
    ]
    return max(ours, key=lambda r: _parse(r["tag_name"]), default=None)


class Updater:
    def __init__(self):
        self.lock = threading.Lock()
        self.checked_at = 0.0
        self.latest: dict | None = None  # {version, notes, url, exe, sha, size}
        self.error = ""
        self.state = "idle"  # idle | downloading | ready | failed
        self.done = 0
        self.total = 0
        self.staged = ""

    # ---- check ----------------------------------------------------------

    def check(self, force: bool = False) -> dict:
        if force or time.time() - self.checked_at > CHECK_EVERY:
            try:
                rel = pick_release(json.loads(_get(API)))
                if rel is None:
                    raise LookupError
                assets = {a["name"]: a for a in rel.get("assets", [])}
                exe, sha = assets.get(EXE), assets.get(EXE + ".sha256")
                self.latest = {
                    "version": rel.get("tag_name", "").lstrip("vV"),
                    "notes": rel.get("body") or "",
                    "url": rel.get("html_url", ""),
                    "published": rel.get("published_at", ""),
                    "exe": exe["browser_download_url"] if exe else "",
                    "sha": sha["browser_download_url"] if sha else "",
                    "size": exe["size"] if exe else 0,
                }
                self.error = ""
            except LookupError:
                self.error = "No releases published yet."
            except urllib.error.HTTPError as e:
                self.error = "No releases published yet." if e.code == 404 else f"GitHub answered {e.code}."
            except Exception:
                self.error = "Couldn't reach GitHub. Check the internet connection."
            self.checked_at = time.time()
        return self.status()

    def status(self) -> dict:
        latest = self.latest
        available = bool(latest and latest["exe"] and _parse(latest["version"]) > _parse(__version__))
        return {
            "current": __version__,
            "latest": latest["version"] if latest else "",
            "notes": latest["notes"] if latest else "",
            "url": latest["url"] if latest else f"https://github.com/{REPO}/releases",
            "published": latest["published"] if latest else "",
            "available": available,
            "canInstall": available and FROZEN and bool(latest["sha"]),
            "error": self.error,
            "state": self.state,
            "done": self.done,
            "total": self.total,
        }

    # ---- download -------------------------------------------------------

    def download(self):
        with self.lock:
            if self.state == "downloading":
                return
            st = self.status()
            if not st["canInstall"]:
                raise RuntimeError("There is no update to install." if not st["available"] else "Updates install from the packaged BACon.exe only.")
            self.state, self.done, self.total, self.error = "downloading", 0, self.latest["size"], ""
        threading.Thread(target=self._download, args=(dict(self.latest),), daemon=True).start()

    def _download(self, latest: dict):
        folder = data_dir("update")
        target = os.path.join(folder, f"BACon-{latest['version']}.exe")
        try:
            expected = _get(latest["sha"]).decode("ascii", "ignore").split()[0].lower()
            h = hashlib.sha256()
            req = urllib.request.Request(latest["exe"], headers={"User-Agent": f"BACon/{__version__}"})
            with urllib.request.urlopen(req, timeout=30) as r, open(target + ".part", "wb") as f:
                self.total = int(r.headers.get("Content-Length") or self.total or 0)
                while chunk := r.read(256 * 1024):
                    f.write(chunk)
                    h.update(chunk)
                    self.done += len(chunk)
            if h.hexdigest() != expected:
                raise ValueError("The download didn't match its checksum, so it was thrown away. Try again.")
            os.replace(target + ".part", target)
            self.staged, self.state = target, "ready"
        except Exception as e:
            try:
                os.remove(target + ".part")
            except OSError:
                pass
            self.state = "failed"
            self.error = str(e) if isinstance(e, ValueError) else "The download stopped part-way. Check the internet connection and try again."

    # ---- apply ----------------------------------------------------------

    def apply(self):
        """Start the swap script, then the caller exits. The script waits for this process, moves the new exe into
        place (keeping the old one as .old until the new one is running), and starts BACon again."""
        if self.state != "ready" or not self.staged or not FROZEN:
            raise RuntimeError("The update isn't downloaded yet.")
        exe = sys.executable
        # a one-file exe runs as two processes: the bootloader (which holds the exe) and this one. Wait for both.
        pids = [os.getpid()]
        try:
            import psutil

            parent = psutil.Process().parent()
            if parent and os.path.normcase(parent.exe()) == os.path.normcase(exe):
                pids.append(parent.pid)
        except Exception:
            pass
        lines = ["@echo off"]
        for p in pids:
            lines += [f":wait{p}", f'tasklist /fi "PID eq {p}" | find " {p} " >nul && (timeout /t 1 /nobreak >nul & goto wait{p})']
        lines += [
            f'move /y "{exe}" "{exe}.old" >nul',
            f'move /y "{self.staged}" "{exe}" >nul || move /y "{exe}.old" "{exe}" >nul',
            f'start "" "{exe}"',
            'del "%~f0"',
        ]
        script = os.path.join(data_dir("update"), "swap.cmd")
        with open(script, "w", encoding="utf-8", newline="\r\n") as f:
            f.write("\n".join(lines) + "\n")
        # break away from the one-file bootloader's job object, or Windows ends the script when BACon exits
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        try:
            subprocess.Popen(["cmd", "/c", script], creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, close_fds=True)
        except OSError:  # the job doesn't allow breakaway
            subprocess.Popen(["cmd", "/c", script], creationflags=flags, close_fds=True)


def clean_previous():
    """After an update, remove the old exe the swap script left behind. It can stay locked for a few seconds while
    antivirus scans the swap, so keep trying in the background."""
    old = sys.executable + ".old"
    if not FROZEN or not os.path.exists(old):
        return

    def remove():
        for _ in range(120):
            try:
                os.remove(old)
                return
            except FileNotFoundError:
                return
            except OSError:
                time.sleep(1)

    threading.Thread(target=remove, daemon=True).start()


updater = Updater()
