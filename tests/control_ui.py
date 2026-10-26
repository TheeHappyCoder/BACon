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

def write_shown(page):
    """Bulk writes act on ticked rows: untick what is left from before, tick every row shown, then Write."""
    bar = page.get_by_role('toolbar', name='Ticked rows')
    if bar.count():
        bar.get_by_role('button', name='Untick every row').click()
    page.get_by_role('checkbox', name='Tick every row shown').click()
    bar.get_by_role('button', name=re.compile('^Write')).click()

BASE = 'http://127.0.0.1:8067'


def chip(page, label):
    """A chip of the triage strip under the scope title, by its label."""
    return page.locator('[aria-label="What needs a look"] button').filter(has_text=re.compile(rf'^\d+\s*{label}$'))


def commanded(row):
    slots = row['values'].get('priority-array')
    return slots is not None and any(s.strip() not in ('', 'null') for s in slots.split('; '))


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
                stored = {r['key']: r for d in devices for r in http(BASE, 'GET', f"/api/devices/{d['instance']}/objects")}
                with sync_playwright() as p:
                    browser = p.chromium.launch(channel='chrome', headless=True)
                    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(BASE)
                    out = ROOT / 'tests' / 'out'
                    out.mkdir(exist_ok=True)
                    # The drawer opens only for an object: nothing is in it until a row is clicked.
                    expect(page.get_by_text('Comfort setpoint', exact=True).first).to_be_visible(timeout=30000)
                    expect(page.get_by_role('button', name='Close this object')).to_have_count(0)
                    # A binary's value cell reads in its own words: the active-text or inactive-text, not active/inactive.
                    binary = next(r for r in stored.values() if r['typeId'] == 5 and r['values'].get('active-text'))
                    words = binary['values']['active-text'] if binary['values']['present-value'] == 'active' else binary['values']['inactive-text']
                    expect(page.locator(f'[data-row-key="{binary["key"]}"]')).to_contain_text(words)
                    expect(page.locator(f'[data-row-key="{binary["key"]}"]')).not_to_contain_text(re.compile(r'\b(in)?active\b'))
                    # The strip counts the objects something holds a priority slot of, over every device.
                    expect(chip(page, 'commanded')).to_have_text(re.compile(rf'^{sum(map(commanded, stored.values()))}\s*commanded$'))
                    setpoint = page.locator('[data-row-key]', has_text='Comfort setpoint').first
                    key = setpoint.get_attribute('data-row-key')
                    target = stored[key]
                    # A single point is commanded from the drawer: live value, command box and priority array.
                    setpoint.get_by_text('Comfort setpoint', exact=True).click()
                    expect(page.get_by_role('button', name='Close this object')).to_be_visible()
                    # Picking the row scopes the page to its device; the strip counts that device before BACon writes.
                    before = sum(commanded(r) for r in stored.values() if r['device'] == target['device'])
                    expect(chip(page, 'commanded')).to_have_text(re.compile(rf'^{before}\s*commanded$'))
                    expect(page.get_by_text('Priority array', exact=True)).to_be_visible(timeout=30000)
                    page.get_by_role('spinbutton', name='New value').fill('22')
                    page.get_by_role('button', name='Write', exact=True).click()
                    expect(page.get_by_text('at priority 8', exact=False)).to_be_visible()
                    page.screenshot(path=str(out / 'control-review.png'))
                    page.get_by_role('button', name='Send', exact=True).click()
                    expect(page.get_by_text('Applied and verified.', exact=False)).to_be_visible(timeout=30000)
                    expect(page.get_by_role('button', name='Release 8', exact=True)).to_be_enabled(timeout=30000)
                    # The value cell carries BACon's slot, and the strip counts the point as commanded.
                    expect(page.locator(f'[data-row-key="{key}"] [title="BACon commanded this point and has not released it"]')).to_have_text('P8', timeout=15000)
                    held = before + (0 if commanded(target) else 1)
                    expect(chip(page, 'commanded')).to_have_text(re.compile(rf'^{held}\s*commanded$'), timeout=15000)
                    assert held >= 1
                    # One live request returns the written value, decoded as a full read stores it.
                    t = {'device': target['device'], 'typeId': target['typeId'], 'instance': target['instance'], 'key': key}
                    live = http(BASE, 'POST', '/api/live', {'targets': [t]})
                    assert live['values'][key]['value'] == '22' and live['values'][key]['error'] is None, live
                    assert live['at'] > 0
                    # ... and the page polls it on its own while the table is on screen.
                    with page.expect_response(lambda r: r.url.endswith('/api/live') and r.request.method == 'POST', timeout=10000) as polled:
                        pass
                    assert polled.value.ok, polled.value.status
                    page.screenshot(path=str(out / 'control-drawer.png'))
                    page.get_by_role('button', name='Release 8', exact=True).click()
                    page.get_by_role('button', name='Release', exact=True).click()
                    expect(page.get_by_text('Released and verified.', exact=False)).to_be_visible(timeout=30000)
                    # Released: BACon's tag goes, and the strip is back to what it counted before the write.
                    expect(page.locator(f'[data-row-key="{key}"] [title="BACon commanded this point and has not released it"]')).to_have_count(0, timeout=15000)
                    if before:
                        expect(chip(page, 'commanded')).to_have_text(re.compile(rf'^{before}\s*commanded$'), timeout=15000)
                    else:
                        expect(chip(page, 'commanded')).to_have_count(0, timeout=15000)
                    page.screenshot(path=str(out / 'control-result.png'))
                    # Bulk writes act on the rows the filter shows, from the … menu above the table.
                    page.get_by_role('button', name='Close this object').click()
                    expect(page.get_by_role('button', name='Close this object')).to_have_count(0)
                    write_shown(page)  # tick every row shown, then Write in the bar over the table
                    expect(page.get_by_text('groups that take the same value', exact=False)).to_be_visible(timeout=60000)
                    page.screenshot(path=str(out / 'control-groups.png'))
                    # The layout at a laptop size: every device, one device, a query, then one of its rows in the drawer.
                    layout = browser.new_page(viewport={'width': 1600, 'height': 900})
                    layout.on('pageerror', lambda error: errors.append(str(error)))
                    layout.goto(BASE)
                    expect(layout.get_by_role('heading', name='All devices')).to_be_visible(timeout=30000)
                    expect(layout.get_by_text('Comfort setpoint', exact=True).first).to_be_visible(timeout=30000)
                    layout.mouse.move(0, 0)
                    layout.wait_for_timeout(600)
                    layout.screenshot(path=str(out / 'alive-network.png'))
                    layout.locator(f'[role=treeitem][title^="#{first["instance"]} ·"]').click()
                    expect(layout.get_by_text('Comfort setpoint', exact=True).first).to_be_visible(timeout=30000)
                    expect(layout.get_by_role('button', name='Close this object')).to_have_count(0)
                    layout.mouse.move(0, 0)
                    layout.wait_for_timeout(600)  # the card fades in when the scope changes
                    layout.screenshot(path=str(out / 'layout-table.png'))
                    layout.screenshot(path=str(out / 'alive-device.png'))
                    # A query: the match count over the table, and each device's own count in the tree.
                    field = layout.get_by_placeholder(re.compile('Search, or type a filter'))
                    field.fill('present-value > 20')
                    field.press('Enter')
                    expect(layout.get_by_text(re.compile(r'^\d+ of \d+ match$'))).to_be_visible()
                    for d in devices:
                        expect(layout.locator(f'[role=treeitem][title^="#{d["instance"]} ·"] [title$=" match"]')).to_have_count(1)
                    layout.mouse.move(0, 0)
                    layout.wait_for_timeout(300)
                    layout.screenshot(path=str(out / 'alive-query.png'))
                    layout.get_by_role('button', name='Remove present-value filter').click()
                    expect(layout.get_by_text(re.compile(r'^\d+ of \d+ match$'))).to_have_count(0)
                    layout.get_by_text('Comfort setpoint', exact=True).first.click()
                    expect(layout.get_by_text('Priority array', exact=True)).to_be_visible(timeout=30000)
                    layout.mouse.move(0, 0)
                    layout.wait_for_timeout(400)  # the pane's open transition
                    layout.screenshot(path=str(out / 'layout-drawer.png'))
                    layout.screenshot(path=str(out / 'alive-drawer.png'))
                    # The same page in the dark theme, for colours that only work on white.
                    layout.evaluate("document.documentElement.classList.add('dark')")
                    layout.wait_for_timeout(200)
                    layout.screenshot(path=str(out / 'alive-dark.png'))
                    assert not errors, errors
                    browser.close()
                print('PASS: drawer only with a row, binary in its own words, drawer command, confirmation, live write, verification, '
                      'P8 in the value cell, commanded chip up and back, /api/live returns the written value and the page polls it, release, '
                      'bulk grouping from the menu, cross-origin rejection, query match counts in the tree, layout screenshots; no browser errors')
            finally:
                server.terminate()
                server.wait(10)


if __name__ == '__main__': run()
