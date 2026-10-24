# Rasher's tests

Two regression gates. Run both before committing a change to Rasher, and give every new profile its baselines.

```sh
python rasher/tests/bacnet.py     # BACnet, about three minutes
cd rasher/web && npm run build && cd ../..
python rasher/tests/faces.py      # the faces, under a minute
```

Both need the backend's packages (`pip install -e rasher`); `faces.py` also needs Playwright and Pillow
(`pip install playwright pillow`) and Chrome.

## bacnet.py

Starts a Rasher of its own (HTTP 8049, settings in a temporary folder, so one you have open is left alone) with one
device of each type on this PC's address, UDP 47830 and up, and checks each device side by side with a plain bacpypes3
client:

- every object and property (ReadPropertyMultiple `all`) against `baselines/<type>.json`. Live values (present
  values, clocks, event states, record counts and the like) and this PC's addressing are compared by presence only,
  and priority arrays by which priorities hold a value. A difference is a change to the device on the wire: make it on
  purpose or not at all.
- SubscribeCOV on every analog, binary and multi-state object; write and relinquish at priority 8 on every writable
  point (taken from `GET /profile`); a refused write to an input in service.
- each alarm in `SCENARIOS`, with the status flags in the last COV notification matching ReadProperty.
- ReadRange by position, sequence number and time on every trend log; the I-Am storm; no errors in the activity log.

`--types fcu vav` checks some types; `--update` rewrites the baselines.

## faces.py

Serves the built UI each fixture (`fixtures/<type>/state.json` and `trend.json`) with the clock frozen and animation
off, screenshots the small window and the full view's tabs, and compares them with `faces/<type>-<view>.png` pixel for
pixel. Differences go to `out/` (ignored by git) as `<name>.png` and `<name>.want.png`.

`--capture` makes new fixtures from a Rasher of its own (`--capture http://127.0.0.1:8048` from one that's running);
`--update` rewrites the baselines.

Fonts and anti-aliasing differ between machines and Chrome versions, so these baselines are this machine's: on another
one, run `--update` once from a known-good commit.

## The baselines

`baselines/fcu.json` and the six `faces/fcu-*.png` are what the FCU was before equipment profiles existed: the dump of
the original RC-1 and the screenshots of its original UI, from the same fixture. Everything since has had to match them.

Update baselines only from a commit you trust, never to make a failing check pass, and say why in the commit.

## A new profile

1. Add its alarm scenarios to `SCENARIOS` in `bacnet.py`.
2. `python rasher/tests/bacnet.py --types <type> --update`, then read `baselines/<type>.json` through: it is the device
   as a BMS sees it.
3. `python rasher/tests/faces.py --capture --types <type>`, then `--update --types <type>`, and look at every image.
4. Run both gates without `--update`.
