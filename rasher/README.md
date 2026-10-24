<p align="center">
  <img src="packaging/icon.svg" width="72" alt="">
</p>

<h1 align="center">Rasher</h1>

<p align="center"><b>A BACnet room controller you can see, touch and break.</b><br>
A simulated BACnet/IP device with a face, for testing a BMS, a scanner or BACon itself, without a site.</p>

Rasher lives in the BACon repository but is its own app: it isn't part of `BACon.exe`, and its releases are tagged
`rasher-vX.Y.Z` so BACon's updater never mistakes one for a BACon release.

## What it is

A room controller, RC-1, looking after a meeting room with a fan coil. As many of them as you like. RC-1 is the first
[equipment profile](#equipment-profiles); other kinds of equipment plug in the same way.

- **Open it again for another thermostat.** Like YABE's room simulator: each launch adds a device one instance up
  from the last, on the next free address, in a small window of its own. Add devices does the same for any number at
  once. Closing a window takes its device (and its address) away; closing the last one quits Rasher.
- **A power switch.** Off, the device answers nothing, as if its supply was cut. On, it boots for a few seconds,
  forgets its COV subscriptions like most controllers do, and announces itself with an I-Am, so you can watch a BMS
  notice it go, then reconnect and resubscribe.
- **A wall unit you can use.** Press − and + like someone in the room, or Here for comfort now. The display shows the
  temperature, setpoint, mode, fan, heating or cooling, CO2, and an LED that flickers with every request answered.
- **Small by default, everything behind More.** The window is the unit, its instance and address, the power switch,
  people and the window. More grows it into the full view: every point with who read and wrote it and at what
  priority, the activity log, alarms, trends, COV subscribers and faults.
- **A room that behaves.** The temperature follows the valves, the weather, an open window and the people in it. CO2
  climbs with people and falls with ventilation. The room clock can run 30× or 120× faster.
- **Its own address.** Each device can sit on UDP 47808 on an address of its own (tested free with ARP and ping), next
  to a scanner on the same PC, just like controllers on the LAN. Or use this PC's address on ports 47809 and up.
- **Faults on demand.** A flaky link, slow replies, a broken sensor, an I-Am storm, warm and cold restarts.

## BACnet coverage

| | |
|---|---|
| Objects | Analog input, output and value; binary input and value; multi-state output and value; loop; schedule; calendar; notification class; trend log; trend log multiple; device; network port |
| Commanding | WriteProperty with a real 16-level priority array and relinquish default; the controller's own loop writes at 16, its schedule at 12. Read-only properties refuse writes (write-access-denied), and inputs take writes only when out of service |
| COV | SubscribeCOV, confirmed and unconfirmed, with lifetimes, on the analog, binary and multi-state objects. Analog objects notify on their COV increment; every object also notifies when its status flags change, and each notification carries the flags a ReadProperty would return |
| Alarms | Intrinsic reporting: high and low limits on room temperature and CO2, change of state on the window contact; GetEventInformation, GetAlarmSummary, AcknowledgeAlarm |
| History | Trend logs with three days of history from the room model; ReadRange by position, sequence number and time |
| Device management | Who-Is / I-Am, Who-Has / I-Have, ReadPropertyMultiple, DeviceCommunicationControl, ReinitializeDevice (cold start clears the priority arrays), TimeSynchronization and UTCTimeSynchronization. protocol-services-supported and protocol-object-types-supported list exactly these. Each I-Am is broadcast on the device's port and also sent to every address that has spoken to the device (`iamTo` in `/api/start`: `"peers"`, `"none"`, or `"ip:port,ip:port"`), so a BMS on another port hears boots and storms |

## Equipment profiles

A device is the same whatever it controls: the power switch and boot, faults, communication control, restarts, time
sync, I-Am, COV, write rules, alarms, schedules, trend logs and the activity log. What it controls is its **equipment
profile**: the BACnet objects, the physical model, the control logic that runs each second, the trend history, the
state its face shows and the control actions it takes. RC-1, the fan coil room controller, is the first profile
(`fcu`); every device has a type, and the default is `fcu`.

To add one, say a chiller plant:

1. **Backend**: `src/rasher/profiles/chiller.py` with a subclass of `Profile` (in `device.py`), registered in
   `profiles/__init__.py`. Give it a `type`, `label` and the device object's `model`, `location` and `description`,
   then:
   - `build()` returns its objects, made from the classes in `device.py` (`AI`, `AVC`, `BIA`, `MSVC`, `Sched`, `TL` and
     the rest), which already have the write rules and the COV fixes. Schedules drive the binary objects they
     reference, and calendars follow their date lists, for every profile.
   - `history(now)` runs the model through the last three days, calling `sample(t)` to fill the trend logs listed in
     `logs`; `sample(now)` then runs once a minute.
   - `tick(now)` is one second of control: read the objects (`dev.held(obj)` tells you when something above priority
     16 holds a point), step the model by `dev.speed` seconds, write the results. `offline(now)` steps the model while
     the device is off or booting.
   - `state()` returns what the face needs, merged into the snapshot (the FCU's is `{"room": {...}}`).
   - `actions` and `faults` describe its own control actions and faults; `act(action, value)` handles the actions and
     returns False for anything else. A fault is switched on and off, and `tick()` reads it from `dev.faults`.
   - `trend(since)` returns what the trends view charts.
2. **Frontend**: `web/src/profiles/chiller/` exporting a `ProfileUI` (see `web/src/profiles/index.tsx`), registered in
   `PROFILES`. `Face` is the middle of the small window, between the name, address and power switch at the top and Add
   devices and More at the bottom; put the unit there with the shared `leds` at the bottom centre, and almost every
   control: More is for the unusual. `Side` is the left column of the full view. `faults`, `scenarios` and `charts`
   fill in the faults card, Make something happen and the trends view. A type the UI doesn't know yet still runs,
   with everything under More.

Once a second profile exists, Setup and Add devices offer a choice of equipment.

## HTTP API

What the UI uses is also there for scripts and agents driving Rasher, on `http://127.0.0.1:8048` (`RASHER_PORT` to
change it).

| | |
|---|---|
| `POST /api/start` | The first device: `{"adapter", "mode": "extra" \| "own", "ip", "port", "instance", "prefix", "iamTo", "type": "fcu"}`. Saved as the pattern for the devices after it |
| `POST /api/devices` | More devices, each the next instance on the next free address: `{"count": n}` of the same type as the newest, or a mix, `{"devices": [{"type": "fcu", "count": 5}]}` (up to 50 at a time) |
| `GET /api/devices` | Every device: instance, name, type, address, port, power |
| `GET /api/profiles` | The types there are |
| `GET /api/d/{instance}/profile` | Discovery: the device's type, its points (with what each takes when written, and alarm limits), the control actions with their value ranges, and the faults. Enough to drive a profile without knowing it in advance |
| `GET /api/d/{instance}/state?since=id` | The snapshot: `device` (with `type`), the profile's state (`room` for the FCU), faults, points, COV subscriptions, peers, and the activity after `since` |
| `POST /api/d/{instance}/control` | `{"action", "key", "value", "priority", "name"}`: `power`, `speed`, `fault`, `storm`, `restart`, `write`, `release`, `oos`, `ack` and `iam` on every device, plus the profile's own (the FCU's `offset`, `people`, `window`, `outside` and `temp`) |
| `GET /api/d/{instance}/trend?hours=24` | The trend data the UI charts, in the profile's shape |

## Run it

Needs Python 3.11+ and Node 20+. Rasher's UI imports BACon's design system from `../web`, so both need their packages.

```sh
pip install -e rasher           # the backend, as an editable install
cd web && npm install && cd ..  # BACon's UI: Rasher reuses its components
cd rasher/web && npm install

rasher --no-browser             # API on :8048
npm run dev                     # UI on :5174, proxies /api to :8048
```

`npm run build` writes the UI into `rasher/src/rasher/web`; `rasher` then opens it in its own window.

Adding addresses to the network adapter needs administrator rights. From source, Windows asks each time devices are
added (once for a whole batch) and when they're removed; the built exe asks once at launch. The address is added with SkipAsSource (this PC
never uses it for its own traffic) and only until the next restart, so a crash never leaves it behind for good.

## Build

```sh
pip install -e "rasher[build]"
python rasher/scripts/build.py   # rasher/dist/Rasher.exe
```

```
rasher/src/rasher/   Python backend: the BACnet device, trend logs, network address handling, API
  profiles/          the equipment profiles: fcu.py is RC-1 and its room
rasher/web/          React + Vite UI (imports ../../web/src/ui from BACon)
  src/profiles/      each profile's face
rasher/packaging/    PyInstaller spec, icon
```

## License

MIT, like BACon. See [LICENSE](../LICENSE).
