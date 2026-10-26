# Point control checks

From the repository root:

```powershell
python -m unittest discover -s tests -v
node --experimental-strip-types tests/control_groups.mjs
npm --prefix web run build
python tests/control_rasher.py
python tests/control_ui.py
python tests/control_site.py      # every kind of write against 4 Rasher devices, then proof they are left as found
python tests/control_site_ui.py   # the same site visit through BACon's screens
python tests/rasher_network.py    # Rasher moves running devices to other ports, keeping their state
```

The unit checks cover wire types, 1-based states, limits, float precision, missing labels,
priority release, stale reviews, connection changes, timeouts and audit-storage failures.
The grouping check includes the 10 analog / 1 binary / 4 matching multistates / 1 different
mapping example.

Both integration scripts start isolated Rasher devices and stop their servers afterward.
Run them sequentially: they share test port 8059. They require a working IPv4 adapter and
Rasher's backend dependencies. The browser test also requires Playwright and installed Chrome,
uses BACon port 8067, and saves review screenshots under the ignored `tests/out/` directory.
It tests the drawer command (numeric write, confirmation, release), bulk grouping of the rows shown,
a real BACnet write and release,
and rejection of cross-origin control requests. Real controller hardware is not covered.

`control_site.py` and `control_site_ui.py` are the site visit: bulk defaults and setpoints, every operating mode
moved by its label, an input written out of service, an alarm set up, driven into alarm on the controller and
acknowledged, a schedule's week, exceptions and default and a holiday calendar edited, a stale review refused,
then everything BACon holds released and every property change undone. Both end by comparing every touched
priority slot and property with a snapshot taken before the visit (Rasher's own logic at priorities 12 and 16
excepted).
