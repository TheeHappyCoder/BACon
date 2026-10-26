"""A site visit against several isolated Rasher devices: every kind of write BACon makes, then proof that the devices
are left as they were found.

  - bulk: relinquish defaults on every setpoint, then the setpoints themselves at priority 8
  - bulk: every operating mode into cooling at priority 8
  - an input taken out of service, given a value, and put back
  - an alarm set up on a point (limits, enable, notification class), driven into alarm, acknowledged, and restored
  - a schedule's week, exceptions and default changed; a calendar's dates changed
  - the action log: what BACon holds, then release everything it holds and undo every property it changed
  - finally every touched priority slot and property matches the snapshot taken before the visit

Run: python tests/control_site.py
"""
import asyncio
import copy
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rasher' / 'tests'))
from bacnet import isolated, http, free_udp
from bacon.client import BacnetClient, Device
from bacon.control import Control


def check(ok, what):
    if not ok:
        raise AssertionError(what)
    print(f'PASS {what}', flush=True)


async def visit(base, devices):
    client = BacnetClient()
    first = devices[0]
    prefix = http(base, 'GET', f"/api/d/{first['instance']}/state")['device']['prefix']
    client.connect(first['ip'], prefix, free_udp(47990, {d['port'] for d in devices}))
    await asyncio.sleep(.2)
    mapped = {d['instance']: Device(instance=d['instance'], address=f"{d['ip']}:{d['port']}") for d in devices}
    control = Control(client, mapped)
    try:
        # read every object, as BACon does when it opens a device
        rows = []
        for d in mapped.values():
            for tid, inst in await client.object_list(d):
                rows.append(await client.read_object(d, int(tid), int(inst)))
        name = lambda r: r['values'].get('object-name', '')
        target = lambda r, prop=None: {k: r[k] for k in ('key', 'device', 'typeId', 'instance')} | ({'property': prop} if prop else {})
        check(len(rows) > 60, f'read {len(rows)} objects from {len(mapped)} devices')

        setpoints = [r for r in rows if r['typeId'] == 2 and 'setpoint' in name(r).lower() and 'offset' not in name(r).lower() and 'relinquish-default' in r['values']]
        modes = [r for r in rows if r['typeId'] == 19 and name(r) == 'Operating mode']
        alarm_point = next(r for r in rows if name(r) == 'Room temperature')
        oos_input = next(r for r in rows if name(r) == 'Room humidity')
        schedule = next(r for r in rows if r['typeId'] == 17)
        calendar = next(r for r in rows if r['typeId'] == 6)
        check(len(setpoints) >= 3 and len(modes) >= 3, f'{len(setpoints)} setpoints and {len(modes)} operating modes on site')

        fields = ([(r, 'relinquish-default') for r in setpoints]
                  + [(alarm_point, p) for p in ('high-limit', 'low-limit', 'deadband', 'limit-enable', 'event-enable', 'notification-class', 'time-delay')]
                  + [(oos_input, 'out-of-service'), (schedule, 'weekly-schedule'), (schedule, 'exception-schedule'),
                     (schedule, 'schedule-default'), (calendar, 'date-list')])
        commanded = setpoints + modes

        async def snapshot():
            out = {}
            for r, prop in fields:
                meta = (await control.prepare([target(r, prop)]))[0]
                assert 'error' not in meta, meta
                out[(r['key'], prop)] = meta['current']
            for r in commanded:
                meta = (await control.prepare([target(r)]))[0]
                out[(r['key'], 'slots')] = meta['slots']
            return out

        before = await snapshot()

        async def write(r, value, prop=None, priority=None, release=False):
            meta = (await control.prepare([target(r, prop)]))[0]
            assert 'error' not in meta, meta
            return await control.execute(meta['token'], value, priority if meta.get('commandable', False) or prop is None and priority else None, release), meta

        # bulk: defaults on every setpoint, then the setpoints themselves
        results = [(await write(r, 23.5, 'relinquish-default'))[0] for r in setpoints]
        check(all(x['state'] == 'verified' for x in results), f'bulk relinquish-default 23.5 on {len(setpoints)} setpoints, all verified')
        results = [(await write(r, 22.0, priority=8))[0] for r in setpoints]
        check(all(x['state'] == 'verified' for x in results), f'bulk present-value 22.0 at priority 8 on {len(setpoints)} setpoints')

        # bulk: every operating mode into one state, chosen by its label on each controller (FCU and VAV number them
        # differently on a real site too)
        results = []
        for r in modes:
            meta = (await control.prepare([target(r)]))[0]
            state = next(c['value'] for c in meta['choices'] if c['label'] == 'Standby')
            results.append(await control.execute(meta['token'], state, 8, False))
        check(all(x['state'] == 'verified' for x in results), f'every operating mode into Standby at priority 8: {len(modes)} verified')

        # an input: refused in service, written out of service, put back
        result, _ = await write(oos_input, 55.0)
        check(result['state'] == 'rejected', f'input in service refuses a value ({result["message"]})')
        result, _ = await write(oos_input, True, 'out-of-service')
        check(result['state'] == 'verified', 'input taken out of service')
        result, _ = await write(oos_input, 55.0)
        check(result['state'] == 'verified', 'out-of-service input takes 55.0')

        # an alarm on the point: tighten the high limit under the room temperature, enable, wait for it, acknowledge
        meta = (await control.prepare([target(alarm_point)]))[0]
        temp = meta['current']
        for prop, value in [('notification-class', 2), ('time-delay', 0), ('deadband', 0.5), ('low-limit', temp - 10),
                            ('limit-enable', [True, True]), ('event-enable', [True, True, True]), ('high-limit', round(temp - 2, 1))]:
            result, _ = await write(alarm_point, value, prop)
            assert result['state'] == 'verified', (prop, result)
        check(True, f'alarm set on Room temperature: high limit {round(temp - 2, 1)} under {temp}, enabled, class 2')
        state = ''
        for _ in range(40):
            events = (await client.events(mapped[alarm_point['device']]))[1]
            mine = next((e for e in events if e['typeId'] == 0 and e['instance'] == alarm_point['instance']), None)
            state = mine['eventState'] if mine else ''
            if state == 'high-limit':
                break
            await asyncio.sleep(.5)
        check(state == 'high-limit', 'the point went into high-limit alarm on the controller')
        ack = await control.acknowledge(target(alarm_point), 0)
        check(ack['state'] == 'verified', f'alarm acknowledged ({ack["value"]})')
        events = (await client.events(mapped[alarm_point['device']]))[1]
        mine = next(e for e in events if e['typeId'] == 0 and e['instance'] == alarm_point['instance'])
        check(mine['acked'][0], 'the controller reports the to-offnormal transition acknowledged')

        # schedules and calendars
        week = copy.deepcopy(before[(schedule['key'], 'weekly-schedule')])
        week[0] = [{'time': '06:30:00', 'value': {'type': 'enumerated', 'value': 1}}, {'time': '20:00:00', 'value': {'type': 'enumerated', 'value': 0}}]
        result, _ = await write(schedule, week, 'weekly-schedule')
        check(result['state'] == 'verified', 'Monday changed to 06:30–20:00 in the weekly schedule')
        exceptions = before[(schedule['key'], 'exception-schedule')] + [
            {'period': {'date': [2026, 12, 24, None]}, 'times': [{'time': '00:00:00', 'value': {'type': 'enumerated', 'value': 0}}], 'priority': 10}]
        result, _ = await write(schedule, exceptions, 'exception-schedule')
        check(result['state'] == 'verified', 'exception added for 24 December')
        result, _ = await write(schedule, {'type': 'enumerated', 'value': 1}, 'schedule-default')
        check(result['state'] == 'verified', 'schedule default changed')
        dates = before[(calendar['key'], 'date-list')] + [{'range': [[2026, 4, 3, None], [2026, 4, 6, None]]}]
        result, _ = await write(calendar, dates, 'date-list')
        check(result['state'] == 'verified', 'Easter added to the holiday calendar')

        # stale review: someone else changes it between review and write
        meta = (await control.prepare([target(schedule, 'schedule-default')]))[0]
        await write(schedule, {'type': 'enumerated', 'value': 0}, 'schedule-default')
        try:
            await control.execute(meta['token'], {'type': 'enumerated', 'value': 1})
            check(False, 'a stale review is refused')
        except ValueError as e:
            check('changed since review' in str(e), 'a stale review is refused')

        # what BACon did: the log, the slots it holds, then put everything back
        log = control.actions()
        held = log['held']
        check(len(held) == len(setpoints) + len(modes), f'BACon holds {len(held)} priority slots (setpoints and modes)')
        for h in held:
            r = next(x for x in rows if x['key'] == h['key'])
            result, _ = await write(r, None, priority=h['priority'], release=True)
            assert result['state'] == 'verified', result
        check(not control.actions()['held'], 'released every slot BACon held')

        # undo property changes newest first, back to what each was before BACon's first change
        firsts = {}
        for a in reversed(control.actions(5000)['actions']):
            if a.get('property') not in (None, 'present-value', 'acknowledge') and a.get('state') == 'verified':
                firsts.setdefault((a['key'], a['property']), a['before'])
        firsts[(oos_input['key'], 'present-value')] = None  # set while out of service; follows the model again
        for (key, prop), value in firsts.items():
            if prop == 'present-value':
                continue
            r = next(x for x in rows if x['key'] == key)
            result, _ = await write(r, value, prop)
            assert result['state'] == 'verified', (prop, result)
        check(True, f'undid {len(firsts) - 1} property changes')

        after = await snapshot()
        differ = [k for k in before if before[k] != after[k] and not (k[1] == 'slots' and _bacon_slots_clean(before[k], after[k]))]
        check(not differ, f'every touched property and BACon priority slot matches the snapshot ({len(before)} compared)' + (f': {differ}' if differ else ''))
        records = control.actions(5000)['actions']
        check(all(r['state'] != 'sending' for r in records), f'{len(records)} actions in the log, none left unresolved')
    finally:
        client.close()


def _bacon_slots_clean(a, b):
    """Rasher's own logic writes at 12 and 16 and may have moved on; every other slot must be exactly as it was."""
    return all(x == y for i, (x, y) in enumerate(zip(a, b)) if i + 1 not in (12, 16))


if __name__ == '__main__':
    folder = tempfile.mkdtemp(prefix='bacon-site-')
    os.environ['LOCALAPPDATA'] = folder
    started = time.time()
    with isolated(http_port=8059, types=['fcu', 'fcu', 'vav', 'meter']) as (base, devices):
        asyncio.run(visit(base, devices))
    print(f'Site visit clean in {time.time() - started:.0f} s; action log in {folder}', flush=True)
