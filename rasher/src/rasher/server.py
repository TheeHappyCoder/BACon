"""Local web server: the JSON API for Rasher's windows, plus the built frontend.

One Rasher process hosts every simulated device. Opening Rasher again doesn't start a second process: it asks the
running one for another device, numbered one up from the last, in a window of its own, the way YABE's room simulator
works when you open it several times.
"""

import asyncio
import ipaddress
import json
import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import netip
from .device import RoomController
from .paths import data_dir
from .version import __version__

app = FastAPI(title="Rasher")
lock = asyncio.Lock()

DEFAULTS = {"adapter": "", "ip": "", "mode": "extra", "instance": 2001, "prefix": "RC", "port": 47809}


def settings() -> dict:
    try:
        with open(os.path.join(data_dir(), "settings.json"), encoding="utf-8") as f:
            return {**DEFAULTS, **json.load(f)}
    except (OSError, ValueError):
        return dict(DEFAULTS)


def save_settings(s: dict) -> None:
    with open(os.path.join(data_dir(), "settings.json"), "w", encoding="utf-8") as f:
        json.dump(s, f, indent=2)


class Entry:
    def __init__(self, dev: RoomController, extra_ip: str | None):
        self.dev = dev
        self.extra_ip = extra_ip  # the address Rasher added for this device, taken off again when it goes


class Host:
    def __init__(self):
        self.devices: dict[int, Entry] = {}  # by device instance
        self.loop: asyncio.AbstractEventLoop | None = None
        self.windows = None  # set by main() when Rasher runs in its own windows

    def next_instance(self, base: int) -> int:
        return max([base - 1, *self.devices]) + 1

    async def add(self, count: int, cfg: dict) -> list[int]:
        """Start `count` devices, each one instance up from the last and on the next free address (or port)."""
        a = _adapter(cfg["adapter"])
        extra = cfg["mode"] == "extra"
        ips: list[str] = []
        if extra:
            ips = await asyncio.to_thread(self.free_addresses, cfg["ip"], a, count)
            try:
                # one administrator prompt for the lot, not one per device
                await asyncio.to_thread(netip.add_many, ips, a["prefix"], a["name"])
            except RuntimeError as e:
                raise HTTPException(400, f"Couldn't add {', '.join(ips)} to {a['name']}: {e}")
        new: list[int] = []
        for i in range(count):
            instance = self.next_instance(int(cfg["instance"]))
            ip, port = (ips[i], 47808) if extra else (a["ip"], self.free_port(int(cfg["port"]), a["ip"]))
            dev = RoomController(ip, a["prefix"], port, instance, f"{cfg['prefix']}-{instance}")
            try:
                await dev.start()
            except Exception as e:
                if extra:
                    await asyncio.to_thread(_quiet_remove, ip)
                if new:
                    continue  # keep the ones that started
                raise HTTPException(400, f"Couldn't open UDP {ip}:{port}: {e}")
            self.devices[instance] = Entry(dev, ip if extra else None)
            new.append(instance)
        return new

    def free_addresses(self, first: str, a: dict, count: int) -> list[str]:
        """Free addresses from `first` upwards, skipping any in use. Each is checked with ARP and ping, several at a
        time, since a free address only shows itself by not answering."""
        from concurrent.futures import ThreadPoolExecutor

        net = ipaddress.IPv4Network(f"{a['ip']}/{a['prefix']}", strict=False)
        running = {e.dev.ip for e in self.devices.values()}
        candidate = ipaddress.IPv4Address(first) if first else net.network_address + 230
        out: list[str] = []
        with ThreadPoolExecutor(8) as pool:
            while len(out) < count:
                batch = []
                while len(batch) < max(4, count - len(out)):
                    if candidate not in net or candidate >= net.broadcast_address:
                        break
                    if str(candidate) not in running:
                        batch.append(str(candidate))
                    candidate += 1
                if not batch:
                    raise HTTPException(400, f"Ran out of free addresses on {net}.")
                checks = pool.map(lambda ip: netip.test(ip, a["ip"], a["prefix"]), batch)
                out += [ip for ip, c in zip(batch, checks) if c["state"] == "free"]
        return out[:count]

    def free_port(self, first: int, ip: str = "") -> int:
        """The first UDP port from `first` up that no device here, and no other program, is using."""
        taken = {e.dev.port for e in self.devices.values()}
        port = first
        while True:
            if port not in taken:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    try:
                        s.bind((ip, port))
                        return port
                    except OSError:
                        pass
            port += 1

    async def remove(self, instance: int) -> None:
        entry = self.devices.pop(instance, None)
        if not entry:
            return
        await entry.dev.stop()
        if entry.extra_ip:
            await asyncio.to_thread(_quiet_remove, entry.extra_ip)

    async def remove_all(self) -> None:
        for instance in list(self.devices):
            await self.remove(instance)

    def get(self, instance: int) -> RoomController:
        entry = self.devices.get(instance)
        if not entry:
            raise HTTPException(404, f"No device {instance} here.")
        return entry.dev


host = Host()


def _quiet_remove(ip: str) -> None:
    try:
        netip.remove(ip)
    except RuntimeError:
        pass  # an ActiveStore address goes at the next reboot anyway


def _adapter(name: str) -> dict:
    a = next((x for x in netip.adapters() if x["name"] == name), None)
    if not a:
        raise HTTPException(400, f"No network adapter called {name!r} with an IPv4 address.")
    return a


@app.on_event("startup")
async def _startup():
    host.loop = asyncio.get_running_loop()


@app.get("/api/version")
def version():
    return {"app": "Rasher", "version": __version__}


@app.get("/api/setup")
def setup():
    return {"settings": settings(), "adapters": netip.adapters(), "admin": netip.is_admin(), "leftover": netip.added(), "windowed": host.windows is not None}


class TestBody(BaseModel):
    ip: str
    adapter: str


@app.post("/api/test")
async def test(body: TestBody):
    a = _adapter(body.adapter)
    return await asyncio.to_thread(netip.test, body.ip.strip(), a["ip"], a["prefix"])


class StartBody(BaseModel):
    adapter: str
    mode: str  # "extra": addresses of their own on 47808; "own": this PC's address on other ports
    ip: str = ""
    port: int = 47809
    instance: int
    prefix: str = "RC"


@app.post("/api/start")
async def start(body: StartBody):
    """The first device, from the setup screen. Its settings become the pattern for every device after it."""
    if not 0 <= body.instance <= 4194302:
        raise HTTPException(400, "The device instance must be between 0 and 4194302.")
    cfg = {**settings(), **body.model_dump(), "prefix": body.prefix.strip() or "RC"}
    async with lock:
        new = await host.add(1, cfg)
    save_settings(cfg)
    return {"instance": new[0]}


class AddBody(BaseModel):
    count: int = 1


@app.post("/api/devices")
async def add_devices(body: AddBody):
    """More devices like the last: one instance up, next free address. Each gets its own window when windowed."""
    cfg = settings()
    if not cfg["adapter"]:
        raise HTTPException(400, "Set up the first device first.")
    async with lock:
        new = await host.add(max(1, min(50, body.count)), cfg)
    if host.windows:
        for instance in new:
            host.windows.open(instance)
    return {"instances": new}


@app.get("/api/devices")
def list_devices():
    return [
        {"instance": i, "name": e.dev.name, "ip": e.dev.ip, "port": e.dev.port, "powered": e.dev.powered}
        for i, e in sorted(host.devices.items())
    ]


@app.delete("/api/devices/{instance}")
async def delete_device(instance: int):
    async with lock:
        await host.remove(instance)
    return {"ok": True}


@app.post("/api/forget")
async def forget(ip: str):
    """Remove an address a previous run left behind."""
    try:
        await asyncio.to_thread(netip.remove, ip)
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@app.get("/api/d/{instance}/state")
def state(instance: int, since: int = 0):
    entry = host.devices.get(instance)
    if not entry:
        return {"running": False, "devices": len(host.devices)}
    return {"running": True, "extraIp": entry.extra_ip, "devices": len(host.devices), **entry.dev.snapshot(since)}


@app.get("/api/d/{instance}/trend")
def trend(instance: int, hours: float = 24):
    """The room log (trend-log-multiple 1) and the CO2 log, as the device itself holds them."""
    dev = host.get(instance)
    since = time.time() - hours * 3600
    room = dev.logs[("trend-log-multiple", 1)].records
    co2 = dev.logs[("trend-log", 4)].records
    return {
        "room": [[t, *v] for _, t, v in room if t >= since],
        "co2": [[t, v] for _, t, v in co2 if t >= since],
    }


class Control(BaseModel):
    action: str
    key: str | None = None
    value: float | int | str | bool | None = None
    priority: int | None = None
    name: str | None = None


@app.post("/api/d/{instance}/control")
async def control(instance: int, c: Control):
    d = host.get(instance)
    r = d.room
    try:
        if c.action == "power":
            d.power(bool(c.value))
        elif c.action == "offset":  # the room unit's + and -
            v = max(-3.0, min(3.0, round(float(c.value) * 2) / 2))
            await d.write("analog-value,2", v, None, "Room unit")
        elif c.action == "people":
            d.auto_people = c.value is None
            if c.value is not None:
                r.people = max(0, min(20, int(c.value)))
        elif c.action == "window":
            r.window_open = bool(c.value)
            d.log("Room", "Window", "Opened" if r.window_open else "Closed", kind="local", obj="binary-input,1")
        elif c.action == "outside":
            r.outside_override = None if c.value is None else float(c.value)
        elif c.action == "temp":  # nudge the room, e.g. to test an alarm without waiting
            r.temp = float(c.value)
        elif c.action == "speed":
            d.speed = max(1, min(600, int(c.value)))
        elif c.action == "fault":
            if c.name not in d.faults:
                raise HTTPException(400, f"Unknown fault {c.name!r}")
            d.faults[c.name] = c.value if c.name == "slow" else bool(c.value)
            d.log("Rasher", "Fault", f"{c.name}: {'on' if c.value else 'off'}" if c.name != "slow" else f"slow replies: {c.value or 0} ms", kind="device")
        elif c.action == "storm":
            d.storm(int(c.value or 10))
        elif c.action == "restart":
            d.restart(str(c.value or "warmstart"))
        elif c.action == "write":
            await d.write(c.key, c.value, c.priority, "Rasher")
        elif c.action == "release":
            await d.write(c.key, None, c.priority, "Rasher")
        elif c.action == "oos":
            obj = d.obj(c.key)
            obj.outOfService = bool(c.value)
            d.log("Rasher", "Out of service", f"{obj.objectName}: {'on' if c.value else 'off'}", kind="local", obj=c.key)
        elif c.action == "ack":
            obj = d.obj(c.key)
            d.acknowledge(obj, str(c.value or obj.eventState), "Rasher")
        elif c.action == "iam":
            d.app.i_am()
            d.log("Rasher", "I-Am", "Announced on the network", kind="discovery")
        else:
            raise HTTPException(400, f"Unknown action {c.action!r}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


# ---- frontend ---------------------------------------------------------------


def _web_dir() -> str | None:
    base = getattr(sys, "_MEIPASS", None)
    path = os.path.join(base, "rasher", "web") if base else os.path.join(os.path.dirname(__file__), "web")
    return path if os.path.isfile(os.path.join(path, "index.html")) else None


WEB = _web_dir()
if WEB:
    app.mount("/assets", StaticFiles(directory=os.path.join(WEB, "assets")), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        target = os.path.join(WEB, path)
        if path and os.path.isfile(target):
            return FileResponse(target)
        return FileResponse(os.path.join(WEB, "index.html"))


# ---- windows ----------------------------------------------------------------

COMPACT = (372, 640)
EXPANDED = (1280, 820)


class Bridge:
    """What a window's page can ask of its window (window.pywebview.api)."""

    def __init__(self, windows: "Windows"):
        self._windows = windows
        self._window = None
        self._instance: int | None = None

    def bind(self, instance: int) -> None:
        """The page shows this device: closing the window removes it."""
        self._instance = int(instance)
        self._windows.by_instance[self._instance] = self._window

    def expand(self, on: bool) -> None:
        w, h = EXPANDED if on else COMPACT
        self._window.resize(w, h)

    def title(self, text: str) -> None:
        self._window.title = text


class Windows:
    def __init__(self, url: str):
        import webview

        self.webview = webview
        self.url = url
        self.by_instance: dict[int, object] = {}
        self.count = 0

    def open(self, instance: int | None) -> None:
        bridge = Bridge(self)
        # cascade new windows across the screen, like dealing cards
        screen = self.webview.screens[0] if self.webview.screens else None
        per_row = max(1, ((screen.width if screen else 1920) - 40) // (COMPACT[0] + 12))
        n = self.count
        self.count += 1
        x = 20 + (n % per_row) * (COMPACT[0] + 12)
        y = 20 + (n // per_row % 3) * 60
        window = self.webview.create_window(
            "Rasher", f"{self.url}/" + (f"?d={instance}" if instance is not None else ""), js_api=bridge,
            width=COMPACT[0], height=COMPACT[1], x=x, y=y, min_size=(340, 560), background_color="#f4f4f5",
        )
        bridge._window = window
        if instance is not None:
            bridge.bind(instance)
        window.events.closed += lambda: self.closed(bridge)

    def closed(self, bridge: Bridge) -> None:
        if bridge._instance is not None:
            self.by_instance.pop(bridge._instance, None)
            if host.loop:
                asyncio.run_coroutine_threadsafe(host.remove(bridge._instance), host.loop)


def _existing_rasher(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/version", timeout=1) as r:
            return json.loads(r.read()).get("app") == "Rasher"
    except Exception:
        return False


def _ask_existing(port: int) -> None:
    """Rasher is already running: ask it for one more device (it opens the window)."""
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/devices", data=b'{"count":1}', headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=60).read()
    except Exception:
        pass


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def _log_to_file():
    if sys.stdout is None or sys.stderr is None:
        log = open(os.path.join(data_dir(), "rasher.log"), "a", encoding="utf-8", buffering=1)
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


def _shutdown(server) -> None:
    if host.loop and host.loop.is_running():
        asyncio.run_coroutine_threadsafe(host.remove_all(), host.loop).result(timeout=60)
    server.should_exit = True


def main():
    """Start the server and open a device window. If Rasher is already running, add a device to it instead.
    --browser uses the default browser; --no-browser only runs the server (for development)."""
    import uvicorn

    _log_to_file()
    port = int(os.environ.get("RASHER_PORT", "8048"))
    if _existing_rasher(port):
        _ask_existing(port)
        return
    if not _port_free(port):
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", log_config=None))
    url = f"http://127.0.0.1:{port}"
    print(f"Rasher {__version__} running at {url}")

    mode = "server" if "--no-browser" in sys.argv else "browser" if "--browser" in sys.argv or not WEB else "window"
    if mode == "window":
        try:
            import webview  # noqa: F401
        except ImportError:
            mode = "browser"

    if mode != "window":
        if mode == "browser" and WEB:
            threading.Timer(1.0, lambda: webbrowser.open(url)).start()
        try:
            server.run()
        finally:
            for e in host.devices.values():
                if e.extra_ip:
                    _quiet_remove(e.extra_ip)
        return

    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.1)

    windows = Windows(url)
    host.windows = windows
    cfg = settings()
    first = None
    if cfg["adapter"] and host.loop:
        # set up before: start the first device straight away, like YABE's simulator
        try:
            first = asyncio.run_coroutine_threadsafe(host.add(1, cfg), host.loop).result(timeout=60)[0]
        except Exception:
            first = None  # the window opens on setup, which shows what went wrong
    windows.open(first)
    windows.webview.start(private_mode=False, storage_path=data_dir("webview"))
    _shutdown(server)  # every window is closed: take the devices and their addresses down


if __name__ == "__main__":
    main()
