"""Integrated browser test against isolated Rasher and BACon processes.
Requires the built web UI and Playwright with Chrome. Run: python tests/control_ui.py
"""
import json
import re
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'rasher' / 'tests'))
from bacnet import isolated, http, free_udp
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
BASE = 'http://127.0.0.1:8067'


def run():
    with isolated(http_port=8059, types=['fcu', 'vav']) as (rasher, devices), tempfile.TemporaryDirectory() as folder:
        with open(Path(folder) / 'server.log', 'w') as log:
            server = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'bacon.server:app', '--host', '127.0.0.1', '--port', '8067'], cwd=ROOT,
                env={**os.environ, 'LOCALAPPDATA': folder}, stdout=log, stderr=subprocess.STDOUT)
            try:
                for _ in range(40):
                    try:
                        http(BASE, 'GET', '/api/status', timeout=1)
                        break
                    except Exception: time.sleep(.25)
                first = devices[0]
                prefix = http(rasher, 'GET', f"/api/d/{first['instance']}/state")['device']['prefix']
                http(BASE, 'POST', '/api/connect', {'ip': first['ip'], 'prefix': prefix, 'port': free_udp(47990, set())})
                for d in devices:
                    http(BASE, 'POST', '/api/devices/add', {'address': f"{d['ip']}:{d['port']}"})
                http(BASE, 'POST', '/api/read', {'devices': [d['instance'] for d in devices]})
                for _ in range(100):
                    if all(j['state'] != 'running' for j in http(BASE, 'GET', '/api/jobs')): break
                    time.sleep(.2)
                # Cross-origin writes and ordinary form-like POSTs must be rejected.
                request = urllib.request.Request(BASE + '/api/control/prepare', data=b'{"targets":[]}', headers={'Content-Type': 'application/json', 'Origin': 'https://example.com', 'X-BACon-Control': '1'})
                try:
                    urllib.request.urlopen(request)
                    raise AssertionError('Cross-origin request accepted')
                except urllib.error.HTTPError as e: assert e.code == 403
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel='chrome', headless=True)
                    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(BASE)
                    out = ROOT / 'tests' / 'out'
                    out.mkdir(exist_ok=True)
                    # A single point is commanded from the drawer: live value, command box and priority array.
                    page.get_by_text('Comfort setpoint', exact=True).first.click()
                    expect(page.get_by_text('Priority array', exact=True)).to_be_visible(timeout=30000)
                    page.get_by_role('spinbutton', name='New value').fill('22')
                    page.get_by_role('button', name='Write', exact=True).click()
                    expect(page.get_by_text('at priority 8', exact=False)).to_be_visible()
                    page.screenshot(path=str(out / 'control-review.png'))
                    page.get_by_role('button', name='Send', exact=True).click()
                    expect(page.get_by_text('Applied and verified.', exact=False)).to_be_visible(timeout=30000)
                    expect(page.get_by_role('button', name='Release 8', exact=True)).to_be_enabled(timeout=30000)
                    page.screenshot(path=str(out / 'control-drawer.png'))
                    page.get_by_role('button', name='Release 8', exact=True).click()
                    page.get_by_role('button', name='Release', exact=True).click()
                    expect(page.get_by_text('Released and verified.', exact=False)).to_be_visible(timeout=30000)
                    page.screenshot(path=str(out / 'control-result.png'))
                    # Bulk writes act on the rows the filter shows.
                    page.get_by_role('button', name='Show all properties').click()
                    page.get_by_role('button', name=re.compile(r'^Write \d+ shown$')).click()
                    expect(page.get_by_text('groups that take the same value', exact=False)).to_be_visible(timeout=60000)
                    page.screenshot(path=str(out / 'control-groups.png'))
                    assert not errors, errors
                    browser.close()
                print('PASS: drawer command, confirmation, live write, verification, release, bulk grouping, cross-origin rejection; no browser errors')
            finally:
                server.terminate()
                server.wait(10)


if __name__ == '__main__': run()
