"""Self-update from GitHub Releases. Kept in step with BACon's (src/bacon/updater.py): same check, download and swap.

Rasher releases from the BACon repo, tagged rasher-vX.Y.Z, with two assets: Rasher.exe and Rasher.exe.sha256. The app checks for the newest release,
downloads the exe next to its data, checks the SHA-256, then hands over to a tiny batch script that waits for this
process to exit, swaps the exe and starts it again. Only the packaged exe updates itself; running from source just
reports what is available.
"""

import hashlib
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

from .paths import data_dir
from .version import REPO, __version__

# GitHub's "latest" is always BACon's, so list the releases and pick ours by tag
API = f"https://api.github.com/repos/{REPO}/releases?per_page=50"
EXE = "Rasher.exe"
TAG = re.compile(r"rasher-v\d+\.\d+\.\d+")
CHECK_EVERY = 6 * 3600  # seconds; the UI asks on boot, this only stops repeat calls hammering GitHub

FROZEN = bool(getattr(sys, "frozen", False))
SYS = r"%SystemRoot%\System32"

# RASHER_MOCK_UPDATE=1 rehearses an update: a pretend 9.9.9, a pretend download, and a restart into this same version
MOCK_ENV = "RASHER_MOCK_UPDATE"
MOCK = os.environ.get(MOCK_ENV, "")


def _parse(tag: str) -> tuple[int, ...]:
    parts = []
    for p in tag.removeprefix("rasher-").lstrip("vV").split("."):
        digits = "".join(c for c in p if c.isdigit())
        parts.append(int(digits or 0))
    return tuple(parts + [0] * (3 - len(parts)))


def _get(url: str, timeout: float = 10) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": f"Rasher/{__version__}", "Accept": "application/vnd.github+json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def pick_release(releases: list) -> dict | None:
    """The newest published Rasher release: the highest rasher-vX.Y.Z tag with Rasher.exe on it."""
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
        self.started = 0.0  # when the download began, for its speed
        self.staged = ""

    # ---- check ----------------------------------------------------------

    def check(self, force: bool = False) -> dict:
        if MOCK:
            return self._mock_check()
        if force or time.time() - self.checked_at > CHECK_EVERY:
            try:
                rel = pick_release(json.loads(_get(API)))
                if rel is None:
                    raise LookupError
                assets = {a["name"]: a for a in rel.get("assets", [])}
                exe, sha = assets.get(EXE), assets.get(EXE + ".sha256")
                self.latest = {
                    "version": rel.get("tag_name", "").removeprefix("rasher-").lstrip("vV"),
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
            "canInstall": available and (FROZEN or bool(MOCK)) and bool(latest["sha"]),
            "error": self.error,
            "state": self.state,
            "done": self.done,
            "total": self.total,
            "rate": self.done / max(0.25, time.time() - self.started) if self.state == "downloading" and self.started else 0,  # bytes a second
        }

    # ---- download -------------------------------------------------------

    def download(self):
        with self.lock:
            if self.state == "downloading":
                return
            st = self.status()
            if not st["canInstall"]:
                raise RuntimeError("There is no update to install." if not st["available"] else "Updates install from the packaged Rasher.exe only.")
            self.state, self.done, self.total, self.error = "downloading", 0, self.latest["size"], ""
            self.started = time.time()
        threading.Thread(target=self._download, args=(dict(self.latest),), daemon=True).start()

    def _download(self, latest: dict):
        if MOCK:
            return self._mock_download()
        folder = data_dir("update")
        target = os.path.join(folder, f"Rasher-{latest['version']}.exe")
        try:
            expected = _get(latest["sha"]).decode("ascii", "ignore").split()[0].lower()
            h = hashlib.sha256()
            req = urllib.request.Request(latest["exe"], headers={"User-Agent": f"Rasher/{__version__}"})
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
        place (keeping the old one in the update folder, out of sight, until the new one is running), and starts Rasher
        again."""
        if self.state != "ready" or not self.staged or not (FROZEN or MOCK):
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
            # Windows' own tools by full path: a PATH with Git or MSYS first has a Unix find and timeout instead
            lines += [f":wait{p}", rf'"{SYS}\tasklist.exe" /fi "PID eq {p}" | "{SYS}\find.exe" " {p} " >nul && ("{SYS}\timeout.exe" /t 1 /nobreak >nul & goto wait{p})']
        if MOCK:  # nothing to swap: start this same app again, the way it was started
            again = [exe] if FROZEN else [exe, *sys.orig_argv[1:]]
            lines += [f'cd /d "{os.getcwd()}"', f'start "" {subprocess.list2cmdline(again)}', 'del "%~f0"']
        else:
            old = _previous()
            lines += [
                f'del /f /q "{old}" >nul 2>&1',
                f'move /y "{exe}" "{old}" >nul',
                f'move /y "{self.staged}" "{exe}" >nul || move /y "{old}" "{exe}" >nul',
                f'start "" "{exe}"',
                'del "%~f0"',
            ]
        script = os.path.join(data_dir("update"), "swap.cmd")
        with open(script, "w", encoding="utf-8", newline="\r\n") as f:
            f.write("\n".join(lines) + "\n")
        # break away from the one-file bootloader's job object, or Windows ends the script when Rasher exits
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
        # a one-file exe passes its own _PYI_* settings to whatever it starts; the new exe would then look for its
        # Python in this one's temp folder, gone by the time it runs ("Failed to load Python DLL"). Start it clean.
        env = {k: v for k, v in os.environ.items() if not k.startswith(("_PYI_", "_MEI"))}
        env["PYINSTALLER_RESET_ENVIRONMENT"] = "1"
        if MOCK:
            env[MOCK_ENV] = "restarted"  # after a rehearsal, it's up to date
        try:
            subprocess.Popen(["cmd", "/c", script], creationflags=flags | subprocess.CREATE_BREAKAWAY_FROM_JOB, close_fds=True, env=env)
        except OSError:  # the job doesn't allow breakaway
            subprocess.Popen(["cmd", "/c", script], creationflags=flags, close_fds=True, env=env)

    # ---- a rehearsal ----------------------------------------------------

    def _mock_check(self) -> dict:
        """A pretend 9.9.9. Once the rehearsal has restarted (the variable is then "restarted"), nothing is newer."""
        if not self.latest:
            self.latest = {
                "version": __version__ if MOCK == "restarted" else "9.9.9",
                "notes": "A pretend release, for rehearsing an update.\n\n- Nothing is downloaded\n- Nothing is replaced\n- Restarting opens this same version again",
                "url": f"https://github.com/{REPO}/releases",
                "published": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "exe": "mock",
                "sha": "mock",
                "size": 21 * 1048576,
            }
        self.error = ""
        self.checked_at = time.time()
        return self.status()

    def _mock_download(self):
        """About eight seconds, a little uneven, like a real connection."""
        while self.done < self.total:
            time.sleep(0.1)
            self.done = min(self.total, self.done + int(self.total / 80 * random.uniform(0.5, 1.5)))
        self.staged, self.state = "mock", "ready"


def _previous() -> str:
    """Where the swap keeps the exe it replaced: the update folder, not next to the exe (often the Desktop)."""
    return os.path.join(data_dir("update"), f"previous-{EXE}")


def clean_previous():
    """After an update, remove the old exe the swap script left behind, and the .old that versions before 0.1.3 left
    next to the exe. Either can stay locked for a while (antivirus scanning the swap, OneDrive syncing a Desktop
    folder), so keep trying in the background."""
    if not FROZEN:
        return
    leftovers = [p for p in (_previous(), sys.executable + ".old") if os.path.exists(p)]
    if not leftovers:
        return

    def remove():
        for _ in range(600):
            for p in list(leftovers):
                try:
                    os.remove(p)
                    leftovers.remove(p)
                except FileNotFoundError:
                    leftovers.remove(p)
                except OSError:
                    pass
            if not leftovers:
                return
            time.sleep(1)

    threading.Thread(target=remove, daemon=True).start()


updater = Updater()
