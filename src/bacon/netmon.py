"""Network monitor: every BACnet/IP packet this app sends or receives, decoded, counted and checked.

On a switched network a PC sees every broadcast (who-is, i-am, who-has, broadcast COV, time sync, router and BBMD
messages) plus its own conversations, but not unicast traffic between other devices; that needs a mirror port.
Broadcasts are where most BACnet trouble shows: who-is floods, i-am storms, duplicate device ids.

Packets can be recorded to a .pcap that Wireshark opens with full BACnet decoding.
"""

import collections
import os
import struct
import time
from dataclasses import dataclass, field

from .paths import clean_old, data_dir

BVLC = {
    0x00: "bvlc-result", 0x01: "write-bdt", 0x02: "read-bdt", 0x03: "read-bdt-ack", 0x04: "forwarded-npdu",
    0x05: "register-foreign-device", 0x06: "read-fdt", 0x07: "read-fdt-ack", 0x08: "delete-fdt-entry",
    0x09: "distribute-broadcast", 0x0A: "original-unicast", 0x0B: "original-broadcast", 0x0C: "secure-bvll",
}
CONFIRMED = {
    0: "acknowledge-alarm", 1: "confirmed-cov-notification", 2: "confirmed-event-notification", 3: "get-alarm-summary",
    4: "get-enrollment-summary", 5: "subscribe-cov", 6: "atomic-read-file", 7: "atomic-write-file", 8: "add-list-element",
    9: "remove-list-element", 10: "create-object", 11: "delete-object", 12: "read-property", 14: "read-property-multiple",
    15: "write-property", 16: "write-property-multiple", 17: "device-communication-control", 18: "confirmed-private-transfer",
    19: "confirmed-text-message", 20: "reinitialize-device", 26: "read-range", 27: "life-safety-operation",
    28: "subscribe-cov-property", 29: "get-event-information", 30: "subscribe-cov-property-multiple",
    31: "confirmed-cov-notification-multiple", 32: "confirmed-audit-notification", 33: "audit-log-query",
}
UNCONFIRMED = {
    0: "i-am", 1: "i-have", 2: "unconfirmed-cov-notification", 3: "unconfirmed-event-notification",
    4: "unconfirmed-private-transfer", 5: "unconfirmed-text-message", 6: "time-synchronization", 7: "who-has", 8: "who-is",
    9: "utc-time-synchronization", 10: "write-group", 11: "unconfirmed-cov-notification-multiple",
    12: "unconfirmed-audit-notification", 13: "who-am-i", 14: "you-are",
}
NETWORK = {
    0: "who-is-router-to-network", 1: "i-am-router-to-network", 2: "i-could-be-router-to-network",
    3: "reject-message-to-network", 4: "router-busy-to-network", 5: "router-available-to-network",
    6: "initialize-routing-table", 7: "initialize-routing-table-ack", 8: "establish-connection-to-network",
    9: "disconnect-connection-to-network", 0x12: "what-is-network-number", 0x13: "network-number-is",
}
PDU_TYPE = {0: "request", 1: "unconfirmed", 2: "simple-ack", 3: "complex-ack", 4: "segment-ack", 5: "error", 6: "reject", 7: "abort"}


@dataclass
class Packet:
    t: float
    outgoing: bool
    src: str
    dst: str
    broadcast: bool
    length: int
    bvlc: str
    kind: str  # request / unconfirmed / complex-ack / error / reject / abort / network / bvlc
    service: str
    device: int | None = None  # device instance announced in an i-am
    note: str = ""

    def to_json(self):
        return {
            "t": self.t, "dir": "out" if self.outgoing else "in", "src": self.src, "dst": self.dst,
            "broadcast": self.broadcast, "length": self.length, "bvlc": self.bvlc, "kind": self.kind,
            "service": self.service, "device": self.device, "note": self.note,
        }


def decode(data: bytes) -> dict:
    """BVLC, NPDU and the start of the APDU: enough to name the service and who announced what."""
    out = {"bvlc": "not-bacnet", "kind": "other", "service": "", "device": None, "origin": None, "note": ""}
    if len(data) < 4 or data[0] != 0x81:
        return out
    func = data[1]
    out["bvlc"] = BVLC.get(func, f"bvlc-{func:#04x}")
    i = 4
    if func == 0x04 and len(data) >= 10:  # forwarded-npdu carries the original sender
        out["origin"] = f"{'.'.join(str(b) for b in data[4:8])}:{int.from_bytes(data[8:10], 'big')}"
        i = 10
    elif func not in (0x04, 0x09, 0x0A, 0x0B):
        out["kind"] = "bvlc"
        out["service"] = out["bvlc"]
        return out
    if len(data) < i + 2 or data[i] != 0x01:
        return out
    control = data[i + 1]
    i += 2
    try:
        if control & 0x20:  # destination specifier
            dlen = data[i + 2]
            i += 3 + dlen
        if control & 0x08:  # source specifier
            slen = data[i + 2]
            i += 3 + slen
        if control & 0x20:
            i += 1  # hop count
        if control & 0x80:  # network layer message
            msg = data[i]
            out["kind"] = "network"
            out["service"] = NETWORK.get(msg, f"network-message-{msg}")
            return out
        apdu = data[i]
        ptype = apdu >> 4
        out["kind"] = PDU_TYPE.get(ptype, "apdu")
        if ptype == 0:
            seg = apdu & 0x08
            out["service"] = CONFIRMED.get(data[i + (5 if seg else 3)], "confirmed-service")
        elif ptype == 1:
            svc = data[i + 1]
            out["service"] = UNCONFIRMED.get(svc, f"unconfirmed-{svc}")
            if svc == 0 and data[i + 2] == 0xC4:  # i-am: object identifier of the device
                oid = int.from_bytes(data[i + 3 : i + 7], "big")
                out["device"] = oid & 0x3FFFFF
                out["note"] = f"device {oid & 0x3FFFFF}"
            if svc == 8 and len(data) > i + 2:
                out["note"] = "with a range"
        elif ptype in (2, 5):
            out["service"] = CONFIRMED.get(data[i + 2], "service")
        elif ptype == 3:
            seg = apdu & 0x08
            out["service"] = CONFIRMED.get(data[i + (4 if seg else 2)], "service")
        elif ptype in (6, 7):
            out["service"] = PDU_TYPE[ptype]
            out["note"] = f"reason {data[i + 2]}"
    except IndexError:
        out["note"] = "truncated"
    return out


# ---- pcap: raw IPv4 frames (LINKTYPE_RAW) so Wireshark decodes BACnet/IP straight away ------------------


def _ip_checksum(header: bytes) -> int:
    s = sum(struct.unpack("!10H", header))
    s = (s >> 16) + (s & 0xFFFF)
    s += s >> 16
    return ~s & 0xFFFF


def _frame(src: str, dst: str, payload: bytes) -> bytes:
    sip, sport = src.rsplit(":", 1)
    dip, dport = dst.rsplit(":", 1)
    udp = struct.pack("!HHHH", int(sport), int(dport), 8 + len(payload), 0) + payload
    header = struct.pack("!BBHHHBBH4s4s", 0x45, 0, 20 + len(udp), 0, 0, 64, 17, 0, bytes(map(int, sip.split("."))), bytes(map(int, dip.split("."))))
    header = header[:10] + struct.pack("!H", _ip_checksum(header)) + header[12:]
    return header + udp


class PcapWriter:
    def __init__(self, path: str):
        self.path = path
        self.count = 0
        self.f = open(path, "wb")
        self.f.write(struct.pack("<IHHiIII", 0xA1B2C3D4, 2, 4, 0, 0, 65535, 101))

    def write(self, t: float, src: str, dst: str, payload: bytes):
        frame = _frame(src, dst, payload)
        sec = int(t)
        self.f.write(struct.pack("<IIII", sec, int((t - sec) * 1e6), len(frame), len(frame)) + frame)
        self.count += 1
        if self.count % 200 == 0:
            self.f.flush()

    def close(self):
        try:
            self.f.close()
        except OSError:
            pass


# ---- the monitor ----------------------------------------------------------------------------------------


@dataclass
class Talker:
    address: str
    first: float
    last: float
    packets: int = 0
    bytes: int = 0
    broadcasts: int = 0
    device: int | None = None
    services: collections.Counter = field(default_factory=collections.Counter)
    problems: collections.Counter = field(default_factory=collections.Counter)


class NetworkMonitor:
    WINDOW = 3600  # seconds of per-second history kept

    def __init__(self):
        self.reset("")

    def reset(self, local: str):
        self.local = local  # our own ip:port
        self.started = time.time()
        self.total = 0
        self.total_bytes = 0
        self.seconds: collections.deque = collections.deque(maxlen=self.WINDOW)  # [second, in_bc, in_uc, out]
        self.packets: collections.deque = collections.deque(maxlen=5000)
        self.talkers: dict[str, Talker] = {}
        self.device_addresses: dict[int, set[str]] = collections.defaultdict(set)
        self.events: collections.deque = collections.deque(maxlen=300)
        self._event_keys: dict[str, float] = {}
        self._iam_times: collections.deque = collections.deque(maxlen=2000)
        self._whois_times: dict[str, collections.deque] = collections.defaultdict(lambda: collections.deque(maxlen=500))
        self.capture: PcapWriter | None = None
        self.last_capture: str = ""

    # -- recording --------------------------------------------------------------

    def start_capture(self):
        self.stop_capture()
        folder = data_dir("captures")
        clean_old(folder)
        path = os.path.join(folder, time.strftime("capture-%Y%m%d-%H%M%S.pcap"))
        self.capture = PcapWriter(path)
        self.last_capture = path

    def stop_capture(self):
        if self.capture:
            self.capture.close()
            self.capture = None

    # -- the tap ----------------------------------------------------------------

    def _event(self, severity: str, kind: str, text: str, source: str = "", every: float = 60.0):
        key = f"{kind}|{source}"
        now = time.time()
        if now - self._event_keys.get(key, 0) < every:
            return
        self._event_keys[key] = now
        self.events.appendleft({"t": now, "severity": severity, "kind": kind, "text": text, "source": source})

    def observe(self, data: bytes, src: str, dst: str, outgoing: bool, broadcast: bool):
        now = time.time()
        if not outgoing and src == self.local:
            return  # our own broadcast coming back
        info = decode(data)
        sender = info["origin"] or src
        pkt = Packet(now, outgoing, sender, dst, broadcast, len(data), info["bvlc"], info["kind"], info["service"], info["device"], info["note"])
        self.packets.append(pkt)
        self.total += 1
        self.total_bytes += len(data)
        if self.capture:
            try:
                self.capture.write(now, src, dst, data)
            except (OSError, ValueError):
                self.stop_capture()

        sec = int(now)
        if not self.seconds or self.seconds[-1][0] != sec:
            self.seconds.append([sec, 0, 0, 0])
        self.seconds[-1][3 if outgoing else (1 if broadcast else 2)] += 1

        if outgoing:
            return
        t = self.talkers.get(sender)
        if t is None:
            t = self.talkers[sender] = Talker(sender, now, now)
        t.last = now
        t.packets += 1
        t.bytes += len(data)
        t.broadcasts += 1 if broadcast else 0
        t.services[info["service"] or info["kind"]] += 1
        if info["kind"] in ("error", "reject", "abort"):
            t.problems[info["kind"]] += 1
            self._event("low", info["kind"], f"{sender} answered with {info['kind']} to {info['service'] or 'a request'}", sender, every=300)

        svc = info["service"]
        if svc == "i-am" and info["device"] is not None:
            t.device = info["device"]
            addrs = self.device_addresses[info["device"]]
            addrs.add(sender)
            if len(addrs) > 1:
                self._event("critical", "duplicate-id", f"Device id {info['device']} is announced by {len(addrs)} addresses: {', '.join(sorted(addrs))}", str(info["device"]), every=300)
            self._iam_times.append(now)
            recent = sum(1 for x in self._iam_times if now - x < 10)
            if recent >= 60:
                self._event("high", "iam-storm", f"I-Am storm: {recent} I-Am messages in 10 seconds", "", every=120)
        elif svc == "who-is":
            q = self._whois_times[sender]
            q.append(now)
            recent = sum(1 for x in q if now - x < 60)
            if recent >= 20:
                self._event("high", "whois-flood", f"{sender} sent {recent} Who-Is in a minute", sender, every=300)
        elif svc in ("reject-message-to-network", "router-busy-to-network"):
            self._event("high", svc, f"{sender}: {svc.replace('-', ' ')}", sender, every=120)

    # -- views --------------------------------------------------------------------

    def status(self, history: int = 300):
        now = int(time.time())
        by_sec = {s[0]: s for s in self.seconds}
        series = [[t, *(by_sec.get(t, [t, 0, 0, 0])[1:])] for t in range(now - history + 1, now + 1)]
        last_min = [s for s in self.seconds if s[0] > now - 60]
        talkers = sorted(self.talkers.values(), key=lambda t: t.packets, reverse=True)
        return {
            "startedAt": self.started,
            "local": self.local,
            "total": self.total,
            "bytes": self.total_bytes,
            "perMinute": {"broadcast": sum(s[1] for s in last_min), "unicast": sum(s[2] for s in last_min), "sent": sum(s[3] for s in last_min)},
            "series": series,
            "talkers": [
                {
                    "address": t.address, "device": t.device, "packets": t.packets, "bytes": t.bytes, "broadcasts": t.broadcasts,
                    "first": t.first, "last": t.last, "services": t.services.most_common(8), "problems": dict(t.problems),
                }
                for t in talkers[:500]
            ],
            "events": list(self.events),
            "capturing": self.capture is not None,
            "captured": self.capture.count if self.capture else 0,
            "lastCapture": os.path.basename(self.last_capture) if self.last_capture else "",
        }

    def recent(self, limit: int = 500, address: str = ""):
        out = []
        for p in reversed(self.packets):
            if address and address not in (p.src, p.dst):
                continue
            out.append(p.to_json())
            if len(out) >= limit:
                break
        return out


monitor = NetworkMonitor()


def install_tap():
    """Wrap bacpypes3's datagram receive and send so every packet passes through the monitor. Idempotent."""
    from bacpypes3.ipv4 import IPv4DatagramProtocol, IPv4DatagramServer
    from bacpypes3.pdu import IPv4Address, LocalBroadcast, LocalStation

    if getattr(IPv4DatagramProtocol, "_bx_tapped", False):
        return
    original_received = IPv4DatagramProtocol.datagram_received
    original_indication = IPv4DatagramServer.indication

    def datagram_received(self, data, addr):
        try:
            # the BVLC function says how it was sent; the receiving socket can't (Windows uses one socket for both)
            broadcast = len(data) > 1 and data[0] == 0x81 and data[1] in (0x04, 0x09, 0x0B)
            monitor.observe(bytes(data), f"{addr[0]}:{addr[1]}", monitor.local, False, broadcast)
        except Exception:
            pass
        return original_received(self, data, addr)

    async def indication(self, pdu):
        try:
            dest = pdu.pduDestination
            if isinstance(dest, LocalBroadcast):
                target, bc = self.broadcast_address, True
            elif isinstance(dest, LocalStation):
                target, bc = IPv4Address(dest).addrTuple, False
            else:
                target, bc = dest.addrTuple, False
            if target:
                monitor.observe(bytes(pdu.pduData), monitor.local, f"{target[0]}:{target[1]}", True, bc)
        except Exception:
            pass
        return await original_indication(self, pdu)

    IPv4DatagramProtocol.datagram_received = datagram_received
    IPv4DatagramServer.indication = indication
    IPv4DatagramProtocol._bx_tapped = True
