"""Rasher's network settings: move running devices to other ports and check each answers there with its state kept
(a value written before the move reads back after it). Own addresses (extra mode) need Windows' administrator
prompt, so only the port move is automatic here."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'rasher', 'tests'))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from bacnet import isolated, http, free_udp  # noqa: E402
from bacon.client import BacnetClient, Device  # noqa: E402


def check(ok, what):
    if not ok:
        raise AssertionError(what)
    print(f'PASS {what}', flush=True)


async def names(client, devices):
    out = {}
    for d in devices:
        dev = Device(instance=d['instance'], address=f"{d['ip']}:{d['port']}")
        row = await client.read_object(dev, 8, d['instance'])
        out[d['instance']] = row['values'].get('object-name')
    return out


async def main(base, devices):
    client = BacnetClient()
    prefix = http(base, 'GET', f"/api/d/{devices[0]['instance']}/state")['device']['prefix']
    client.connect(devices[0]['ip'], prefix, free_udp(47990, set(range(47830, 47960))))
    await asyncio.sleep(.2)
    before = await names(client, devices)
    check(all(before.values()), f'{len(devices)} devices answer at {", ".join(str(d["port"]) for d in devices)}')

    # a mark on the first device that only survives if its objects do
    first = devices[0]['instance']
    points = http(base, 'GET', f'/api/d/{first}/profile')['points']
    sp = next(p for p in points if p['commandable'] and p['type'] == 'analog-value')
    http(base, 'POST', f'/api/d/{first}/control', {'action': 'write', 'key': sp['key'], 'value': 23.5, 'priority': 9})

    start = free_udp(47900, set())
    res = http(base, 'POST', '/api/network', {'mode': 'own', 'port': start})
    moved = res['devices']
    check(not res['problems'], 'no device had a problem moving')
    check(sorted(d['port'] for d in moved) == list(range(start, start + len(devices))), f'devices now on {start}..{start + len(devices) - 1}')
    after = await names(client, moved)
    check(after == before, 'every device answers at its new port, same instance and name')
    old = Device(instance=first, address=f"{devices[0]['ip']}:{devices[0]['port']}")
    try:
        await asyncio.wait_for(client.read_object(old, 8, first), 4)
        gone = False
    except Exception:
        gone = True
    check(gone, 'nothing answers at the old port')
    state = http(base, 'GET', f'/api/d/{first}/state')
    held = next(p for p in state['points'] if p['key'] == sp['key'])
    check(held['value'] == 23.5, f'{sp["name"]} kept its P9 write across the move')

    # shift onto each other's ports: the range starts one above, so each takes its neighbour's
    res = http(base, 'POST', '/api/network', {'mode': 'own', 'port': start + 1})
    check(not res['problems'] and sorted(d['port'] for d in res['devices']) == list(range(start + 1, start + 1 + len(devices))), 'a shifted range moves cleanly')
    check(await names(client, res['devices']) == before, 'and every device answers there')
    net = http(base, 'GET', '/api/network')
    check(net['mode'] == 'own' and net['port'] == start + 1, 'the new addressing is saved for devices added later')
    http(base, 'POST', f'/api/d/{first}/control', {'action': 'release', 'key': sp['key'], 'priority': 9})


if __name__ == '__main__':
    with isolated(http_port=8059, types=['fcu', 'fcu', 'vav']) as (base, devices):
        asyncio.run(main(base, devices))
    print('PASS rasher network', flush=True)
