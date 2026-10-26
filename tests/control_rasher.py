"""Real BACnet write/read-back/release checks against an isolated Rasher.

Run: python tests/control_rasher.py
"""
import asyncio
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rasher' / 'tests'))
from bacnet import isolated, http, free_udp
from bacon.client import BacnetClient, Device
from bacon.control import Control, SUPPORTED


async def exercise(base, devices):
    client = BacnetClient()
    first = devices[0]
    prefix = http(base, 'GET', f"/api/d/{first['instance']}/state")['device']['prefix']
    client.connect(first['ip'], prefix, free_udp(47990, {d['port'] for d in devices}))
    await asyncio.sleep(.2)
    mapped = {d['instance']: Device(instance=d['instance'], address=f"{d['ip']}:{d['port']}") for d in devices}
    control = Control(client, mapped)
    with tempfile.TemporaryDirectory() as folder:
        previous = os.environ.get('LOCALAPPDATA')
        os.environ['LOCALAPPDATA'] = folder
        try:
            kinds = set()
            for d in mapped.values():
                ids = await client.object_list(d)
                for tid, inst in ids:
                    if int(tid) not in SUPPORTED: continue
                    target = dict(device=d.instance, typeId=int(tid), instance=int(inst), key=f'{d.instance}:{int(tid)},{inst}')
                    meta = (await control.prepare([target]))[0]
                    assert 'error' not in meta, meta
                    value = 21.0 if meta['kind'] == 'analog' and meta['units'] == 'degrees-celsius' else meta['current']
                    if meta['kind'] != 'analog': value = meta['choices'][-1]['value']
                    result = await control.execute(meta['token'], float(value), 8 if meta['commandable'] else None, False)
                    if not meta['commandable'] and result['state'] == 'rejected' and result['message'] == 'write-access-denied':
                        print(f"PASS {meta['name']}: read-only value rejected correctly", flush=True)
                        continue
                    assert result['state'] == 'verified', result
                    kinds.add(meta['kind'])
                    fresh = (await control.prepare([target]))[0]
                    restored = await control.execute(fresh['token'], None if meta['commandable'] else meta['current'], 8 if meta['commandable'] else None, meta['commandable'])
                    assert restored['state'] == 'verified', restored
                    print(f"PASS {meta['name']}: {meta['kind']} {'priority + release' if meta['commandable'] else 'direct + restore'}", flush=True)
            assert kinds == {'analog', 'binary', 'multistate'}, kinds
        finally:
            client.close()
            if previous is None: os.environ.pop('LOCALAPPDATA', None)
            else: os.environ['LOCALAPPDATA'] = previous


if __name__ == '__main__':
    with isolated(http_port=8059, types=['fcu', 'vav']) as (base, devices):
        asyncio.run(exercise(base, devices))
