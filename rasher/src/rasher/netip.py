"""Give the simulator an address of its own on the LAN, so it can sit on UDP 47808 next to a scanner on the same PC.

The address is added with -SkipAsSource (Windows never uses it for this PC's own traffic) to the ActiveStore (it is
gone after a reboot even if Rasher is killed), and removed again when the device stops. Adding and removing an
address needs administrator rights; without them Windows asks once per change.
"""

import ctypes
import ipaddress
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor

import psutil

from .paths import data_dir

STATE = "added.json"


def adapters() -> list[dict]:
    stats = psutil.net_if_stats()
    out = []
    for name, addrs in psutil.net_if_addrs().items():
        for a in addrs:
            if a.family != socket.AF_INET or a.address.startswith(("127.", "169.254.")):
                continue
            prefix = ipaddress.IPv4Network(f"0.0.0.0/{a.netmask or '255.255.255.0'}").prefixlen
            out.append({"name": name, "ip": a.address, "prefix": prefix, "up": bool(stats.get(name) and stats[name].isup)})
    # an address Rasher added shows up as a second address on the adapter; list the adapter by its own address
    mine = set(added())
    return [a for a in out if a["ip"] not in mine]


def local_ips() -> set[str]:
    return {a.address for addrs in psutil.net_if_addrs().values() for a in addrs if a.family == socket.AF_INET}


def is_admin() -> bool:
    try:
        return bool(ctypes.windll.shell32.IsUserAnAdmin())
    except Exception:
        return False


def _arp(ip: str) -> str | None:
    """The MAC address of whoever answers ARP for ip, or None. ARP gets an answer even when a firewall drops pings."""
    if sys.platform != "win32":
        return None
    mac = (ctypes.c_ubyte * 8)()
    length = ctypes.c_ulong(8)
    dest = struct.unpack("<I", socket.inet_aton(ip))[0]
    if ctypes.windll.iphlpapi.SendARP(dest, 0, ctypes.byref(mac), ctypes.byref(length)) != 0:
        return None
    return "-".join(f"{b:02x}" for b in mac[: length.value])


def _ping(ip: str) -> bool:
    try:
        out = subprocess.run(
            ["ping", "-n", "2", "-w", "600", ip], capture_output=True, text=True, timeout=5,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).stdout
    except (OSError, subprocess.SubprocessError):
        return False
    return "TTL=" in out.upper()


def test(ip: str, adapter_ip: str, prefix: int) -> dict:
    """Is ip a sensible, unused address on the adapter's subnet? Checks the subnet, then ARP and ping together."""
    try:
        addr = ipaddress.IPv4Address(ip)
        net = ipaddress.IPv4Network(f"{adapter_ip}/{prefix}", strict=False)
    except ValueError:
        return {"state": "invalid", "text": "That isn't an IPv4 address."}
    if addr not in net:
        return {"state": "invalid", "text": f"{ip} isn't on {net}, the network this adapter is on."}
    if addr in (net.network_address, net.broadcast_address):
        return {"state": "invalid", "text": f"{ip} is the {'network' if addr == net.network_address else 'broadcast'} address of {net}."}
    if ip == adapter_ip:
        return {"state": "yours", "text": "That's this PC's own address. Rasher would need another port, so a scanner here can't use 47808 with it."}
    if ip in added():
        return {"state": "free", "text": f"{ip} is still on this PC from Rasher's last run, so it can be used straight away."}
    if ip in local_ips():
        return {"state": "taken", "text": f"{ip} is already one of this PC's addresses."}
    with ThreadPoolExecutor(2) as pool:
        mac_f, ping_f = pool.submit(_arp, ip), pool.submit(_ping, ip)
        mac, pinged = mac_f.result(), ping_f.result()
    if mac:
        return {"state": "taken", "text": f"Something already answers on {ip} (MAC {mac}). Pick another address.", "mac": mac}
    if pinged:
        return {"state": "taken", "text": f"Something already answers pings on {ip}. Pick another address."}
    return {"state": "free", "text": f"Nothing answered on {ip}. It looks free."}


def _saved() -> list[str]:
    try:
        with open(os.path.join(data_dir(), STATE), encoding="utf-8") as f:
            return list(json.load(f))
    except (OSError, ValueError):
        return []


def added() -> list[str]:
    """Addresses Rasher added that are still on this PC."""
    ips = local_ips()
    return [ip for ip in _saved() if ip in ips]


def _remember(ips: list[str]) -> None:
    with open(os.path.join(data_dir(), STATE), "w", encoding="utf-8") as f:
        json.dump(ips, f)


def _powershell(script: str) -> None:
    """Run a PowerShell script, elevated if this process isn't. Raises RuntimeError with PowerShell's message."""
    err = os.path.join(tempfile.gettempdir(), f"rasher-{os.getpid()}-{time.time_ns()}.txt")
    wrapped = f"$ErrorActionPreference='Stop'; try {{ {script}; exit 0 }} catch {{ $_.Exception.Message | Out-File -Encoding utf8 '{err}'; exit 1 }}"
    args = ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", wrapped]
    try:
        if is_admin():
            code = subprocess.run(["powershell", *args], creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0), timeout=60).returncode
        else:
            code = _run_elevated("powershell", subprocess.list2cmdline(args))
        if code != 0:
            msg = ""
            if os.path.exists(err):
                with open(err, encoding="utf-8-sig") as f:
                    msg = f.read().strip()
            raise RuntimeError(msg or ("Windows didn't allow it (the administrator prompt was declined)." if code == 1223 else f"PowerShell exited with {code}."))
    finally:
        if os.path.exists(err):
            os.remove(err)


def _run_elevated(exe: str, params: str) -> int:
    """ShellExecuteEx with the runas verb: Windows shows its administrator prompt, then we wait for the exit code."""
    from ctypes import wintypes

    class SHELLEXECUTEINFO(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD), ("fMask", ctypes.c_ulong), ("hwnd", wintypes.HWND), ("lpVerb", wintypes.LPCWSTR),
            ("lpFile", wintypes.LPCWSTR), ("lpParameters", wintypes.LPCWSTR), ("lpDirectory", wintypes.LPCWSTR),
            ("nShow", ctypes.c_int), ("hInstApp", wintypes.HINSTANCE), ("lpIDList", ctypes.c_void_p),
            ("lpClass", wintypes.LPCWSTR), ("hkeyClass", wintypes.HKEY), ("dwHotKey", wintypes.DWORD),
            ("hIcon", wintypes.HANDLE), ("hProcess", wintypes.HANDLE),
        ]

    info = SHELLEXECUTEINFO(cbSize=ctypes.sizeof(SHELLEXECUTEINFO), fMask=0x40, lpVerb="runas", lpFile=exe, lpParameters=params, nShow=0)
    if not ctypes.windll.shell32.ShellExecuteExW(ctypes.byref(info)):
        return ctypes.GetLastError() or 1223
    ctypes.windll.kernel32.WaitForSingleObject(info.hProcess, 60000)
    code = wintypes.DWORD()
    ctypes.windll.kernel32.GetExitCodeProcess(info.hProcess, ctypes.byref(code))
    ctypes.windll.kernel32.CloseHandle(info.hProcess)
    return code.value


def add(ip: str, prefix: int, adapter: str) -> None:
    add_many([ip], prefix, adapter)


def add_many(ips: list[str], prefix: int, adapter: str) -> None:
    """Add the addresses to the adapter in one go (one administrator prompt), then wait until Windows has checked
    nobody else uses them (duplicate address detection)."""
    local = local_ips()
    mine = set(added())
    for ip in ips:
        if ip in local and ip not in mine:
            raise RuntimeError(f"{ip} is already one of this PC's addresses.")
    todo = [ip for ip in ips if ip not in local]
    if todo:
        _powershell("; ".join(
            f"New-NetIPAddress -InterfaceAlias '{adapter}' -IPAddress {ip} -PrefixLength {prefix} -SkipAsSource $true -PolicyStore ActiveStore | Out-Null"
            for ip in todo
        ))
        # remember them straight away: added() only lists addresses that are on the PC, so read the file directly
        _remember(sorted(set(_saved()) | set(todo)))
    deadline = time.time() + 10
    waiting = list(ips)
    while waiting and time.time() < deadline:
        for ip in list(waiting):
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                try:
                    s.bind((ip, 0))
                    waiting.remove(ip)
                except OSError:
                    pass  # still tentative while Windows checks for a duplicate
        if waiting:
            time.sleep(0.4)
    if waiting:
        for ip in waiting:
            remove(ip)
        raise RuntimeError(f"Windows found another device using {', '.join(waiting)}, so it was taken off again. Pick another address.")


def remove(ip: str) -> None:
    if ip in local_ips():
        _powershell(f"Remove-NetIPAddress -IPAddress {ip} -Confirm:$false")
    _remember([x for x in _saved() if x != ip])
