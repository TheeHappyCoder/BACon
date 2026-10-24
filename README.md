<p align="center">
  <img src="packaging/icon.svg" width="72" alt="">
</p>

<h1 align="center">BACon</h1>

<p align="center"><b>BACnet, on site.</b><br>
Scan a BACnet/IP network, read every property of every object, and export what you pick to Excel.</p>

<p align="center">
  <a href="https://github.com/TheeHappyCoder/BACon/releases/latest">Download for Windows</a>
</p>

![Objects](docs/images/objects.png)

## Why

Tools like YABE show you every property, but they can't export them. The EDE export leaves out
vendor properties such as the Siemens `Input/Output address [3019]`, which is exactly what you need
for an I/O list. BACon reads everything a controller reports, including proprietary properties, and
lets you choose the columns.

## Features

- **Discover**: Who-Is on any network adapter, optional BBMD registration, or add a device by IP.
- **Read everything**: every object and every property, standard and vendor-specific, with clean
  handling of properties a device doesn't have and objects that fail to read.
- **Pick and export**: tick any property to add it as a column, filter with plain words or queries
  like `present-value > 20`, then export to Excel or CSV.
- **Health check**: saved checks that run against every site you open.
- **Compare**: save a site to a `.bxsite` file and see what changed since.
- **Trends**: record points by COV, falling back to polling, then chart and export them. Trend logs
  bring the controller's own history with them (ReadRange), so you see last night straight away.
- **Schedules**: every Schedule object laid out by week or month as the controller runs it, with
  exceptions, calendars, the value now and the next change.
- **Alarms**: every object with an alarm set up, its state and acknowledgements live from the
  controller (GetEventInformation), what sets it off and who gets notified.
- **Network**: live BACnet traffic, issue detection (duplicate IDs, I-Am storms, error replies) and
  `.pcap` capture for Wireshark.
- **Read-only**: BACon never writes to a device.

| Trends | Network |
|---|---|
| ![Trends](docs/images/trends.png) | ![Network](docs/images/network.png) |

## Install

Download `BACon.exe` from the [latest release](https://github.com/TheeHappyCoder/BACon/releases/latest)
and run it. There's no installer and nothing else to install. When a new release is out, BACon shows
a dot on the update button in the rail; one click downloads it, checks its SHA-256 and restarts.

Close YABE and other BACnet tools first, or pick another UDP port: many controllers only answer on 47808.

Trend recordings, captures and logs live in `%LOCALAPPDATA%\BACon`. Files older than 30 days are removed.

## Development

Needs Python 3.11+ and Node 20+.

```sh
pip install -e .            # the backend, as an editable install
cd web && npm install

bacon --no-browser          # API on :8047
npm run dev                 # UI on :5173, proxies /api to :8047
```

No site to hand? `python scripts/simdevice.py <your-ip>` runs a simulated controller on UDP 47809 with
points, alarms in every state, schedules, a calendar and trend logs with three days of history. Connect
as usual, then add the device by IP as `<your-ip>:47809`.

`npm run build` writes the UI into `src/bacon/web`, and `bacon` then serves it in its own window.
Use `bacon --browser` to open it in your browser instead.

```
src/bacon/      Python backend: BACnet client, decoding, trends, network monitor, updater
src/bacon/data/ vendor property names
web/            React + Vite UI
packaging/      PyInstaller spec, icon
scripts/        build, release, and the simulated controller
```

## Releasing

```sh
pip install -e ".[build]"
python scripts/build.py                          # dist/BACon.exe + BACon.exe.sha256
python scripts/release.py 0.2.0 "What changed"   # bump, build, tag, push, GitHub release
```

The app updates from the newest GitHub release that has `BACon.exe` and `BACon.exe.sha256` attached.

## Credits

- [bacpypes3](https://github.com/JoelBender/BACpypes3) (MIT) does the BACnet work.
- Vendor property names come from [YABE](https://sourceforge.net/projects/yetanotherbacnetexplorer/)'s
  `VendorPropertyMapping.csv` (MIT, © 2014 Yabe project). See `src/bacon/data/LICENSE-yabe.txt`.
