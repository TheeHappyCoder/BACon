<p align="center">
  <img src="packaging/icon.svg" width="72" alt="">
</p>

<h1 align="center">Rasher</h1>

<p align="center"><b>A BACnet room controller you can see, touch and break.</b><br>
A simulated BACnet/IP device with a face, for testing a BMS, a scanner or BACon itself, without a site.</p>

Rasher lives in the BACon repository but is its own app: it isn't part of `BACon.exe`, and its releases are tagged
`rasher-vX.Y.Z` so BACon's updater never mistakes one for a BACon release.

## What it is

A room controller, RC-1, looking after a meeting room with a fan coil. As many of them as you like.

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
| COV | SubscribeCOV, confirmed and unconfirmed, with lifetimes and COV increments |
| Alarms | Intrinsic reporting: high and low limits on room temperature and CO2, change of state on the window contact; GetEventInformation, GetAlarmSummary, AcknowledgeAlarm |
| History | Trend logs with three days of history from the room model; ReadRange by position, sequence number and time |
| Device management | Who-Is / I-Am, Who-Has / I-Have, ReadPropertyMultiple, DeviceCommunicationControl, ReinitializeDevice (cold start clears the priority arrays), TimeSynchronization and UTCTimeSynchronization |

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
rasher/src/rasher/   Python backend: the room model, the BACnet device, trend logs, network address handling, API
rasher/web/          React + Vite UI (imports ../../web/src/ui from BACon)
rasher/packaging/    PyInstaller spec, icon
```

## License

MIT, like BACon. See [LICENSE](../LICENSE).
