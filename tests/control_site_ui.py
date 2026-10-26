"""The site visit through BACon's own screens, against several isolated Rasher devices (two FCUs and a VAV):
command a point and change its default in the drawer, set up an alarm and acknowledge it, bulk-write every operating
mode and every setpoint default, edit a schedule's week, then release everything from Activity, undo every property
change, and prove the devices are left as they were found.

Requires the built web UI (npm --prefix web run build), Playwright and Chrome. Run: python tests/control_site_ui.py
Screenshots go to tests/out/site-*.png.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

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
OUT = ROOT / 'tests' / 'out'


def prepare(target, prop=None):
    """Review one target through BACon's control endpoint, as the UI does."""
    body = json.dumps({'targets': [{**target, **({'property': prop} if prop else {})}]}).encode()
    req = urllib.request.Request(BASE + '/api/control/prepare', data=body, method='POST', headers={'Content-Type': 'application/json', 'X-BACon-Control': '1'})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read())[0]


def step(what):
    print(f'PASS {what}', flush=True)


def snapshot():
    """Every BACon slot and every property the visit touches, read live through BACon's own review endpoint."""
    rows = [r for d in http(BASE, 'GET', '/api/devices') for r in http(BASE, 'GET', f"/api/devices/{d['instance']}/objects")]
    name = lambda r: r['values'].get('object-name', '')
    touched = [(r, 'relinquish-default') for r in rows if r['typeId'] == 2 and 'relinquish-default' in r['values']]
    touched += [(r, p) for r in rows if name(r) in ('Room temperature', 'Zone temperature') for p in ('high-limit', 'event-enable', 'notification-class', 'time-delay', 'limit-enable')]
    touched += [(r, p) for r in rows if r['typeId'] == 17 for p in ('weekly-schedule', 'exception-schedule', 'schedule-default')]
    out = {}
    for r, prop in touched:
        f = prepare({k: r[k] for k in ('key', 'device', 'typeId', 'instance')}, prop)
        if 'error' not in f:
            out[(r['key'], prop)] = f['current']
    for r in rows:
        if r['typeId'] in (1, 2, 4, 5, 14, 19) and 'priority-array' in r['values']:
            p = prepare({k: r[k] for k in ('key', 'device', 'typeId', 'instance')})
            if 'error' not in p:
                out[(r['key'], 'slots')] = [v for i, v in enumerate(p['slots']) if i + 1 not in (12, 16)]  # Rasher's own logic writes at 12 and 16
    return out


def run():
    OUT.mkdir(exist_ok=True)
    with isolated(http_port=8059, types=['fcu', 'fcu', 'vav']) as (rasher, devices), tempfile.TemporaryDirectory() as folder:
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
                    for attempt in range(20):  # a device just added in Rasher is still booting
                        try:
                            http(BASE, 'POST', '/api/devices/add', {'address': f"{d['ip']}:{d['port']}"})
                            break
                        except urllib.error.HTTPError:
                            if attempt == 19: raise
                            time.sleep(1)
                http(BASE, 'POST', '/api/read', {'devices': [d['instance'] for d in devices]})
                for _ in range(100):
                    if all(j['state'] != 'running' for j in http(BASE, 'GET', '/api/jobs')): break
                    time.sleep(.2)
                before = snapshot()
                step(f'snapshot of {len(before)} slots and properties on {len(devices)} devices')

                with sync_playwright() as p:
                    browser = p.chromium.launch(channel='chrome', headless=True)
                    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(BASE)
                    search = page.get_by_placeholder(re.compile('Search, or type a filter'))

                    # ---- the drawer: command, then change the default ----
                    page.get_by_text('Comfort setpoint', exact=True).first.click()
                    expect(page.get_by_text('Priority array', exact=True)).to_be_visible(timeout=30000)
                    page.get_by_role('spinbutton', name='New value').fill('22.5')
                    page.get_by_role('button', name='Write', exact=True).click()
                    page.get_by_role('button', name='Send', exact=True).click()
                    expect(page.get_by_text('Applied and verified.', exact=False).first).to_be_visible(timeout=30000)
                    expect(page.locator('[title="BACon commanded this point and has not released it"]', has_text='P8').first).to_be_visible(timeout=15000)
                    step('drawer: Comfort setpoint commanded to 22.5 at P8; the value cell marks it P8')
                    page.get_by_role('button', name='Edit Relinquish default').click()
                    page.get_by_role('spinbutton', name='Relinquish default').fill('20.5')
                    page.get_by_role('button', name='Review', exact=True).click()
                    expect(page.get_by_text('from', exact=True)).to_be_visible()
                    page.screenshot(path=str(OUT / 'site-1-drawer-review.png'))
                    page.get_by_role('button', name='Send', exact=True).click()
                    expect(page.get_by_role('status').filter(has_text=re.compile('^verified$'))).to_have_count(1, timeout=30000)
                    page.screenshot(path=str(OUT / 'site-2-drawer.png'))
                    step('drawer: relinquish default changed to 20.5 and verified')

                    # ---- an alarm on the point, from the drawer, then acknowledged in Alarms ----
                    page.get_by_text('Room temperature', exact=True).first.click()
                    expect(page.get_by_text('Alarm', exact=True)).to_be_visible(timeout=15000)
                    def set_prop(label, fill=None, check=None):
                        page.get_by_role('button', name=f'Edit {label}').click()
                        if fill is not None:
                            page.get_by_role('spinbutton', name=label).fill(str(fill))
                        for name in check or []:
                            box = page.get_by_role('group', name=label).locator('label', has_text=name).get_by_role('checkbox')
                            if box.get_attribute('aria-checked') != 'true':
                                box.click()
                        results = page.get_by_role('status').filter(has_text=re.compile('verified|denied|match'))
                        seen = results.count()
                        page.get_by_role('button', name='Review', exact=True).click()
                        page.get_by_role('button', name='Send', exact=True).click()
                        expect(results).to_have_count(seen + 1, timeout=30000)
                        assert all('verified' in t for t in results.all_inner_texts()), (label, results.all_inner_texts())
                    set_prop('Time delay', 0)
                    set_prop('Notification class', 1)  # Comfort alarms: acknowledgement required
                    set_prop('Report transitions', check=['To alarm', 'To fault', 'To normal'])
                    set_prop('High limit', 15)
                    page.screenshot(path=str(OUT / 'site-3-alarm-setup.png'))
                    step('alarm set up on Room temperature from the drawer: high limit 15, reporting on, class 1')
                    page.get_by_role('button', name=re.compile('^Alarms')).click()
                    for _ in range(20):  # the controller marks the transition unacknowledged on its next tick
                        page.get_by_role('button', name='Check now').click()
                        page.wait_for_timeout(1000)
                        if page.get_by_role('button', name='Not acknowledged 1').count():
                            break
                    page.get_by_text('Room temperature', exact=True).first.click()
                    expect(page.get_by_text('Waiting for acknowledgement')).to_be_visible(timeout=15000)
                    page.screenshot(path=str(OUT / 'site-4-alarm.png'))
                    page.get_by_role('button', name='Acknowledge', exact=True).first.click()
                    expect(page.get_by_text('acknowledged by BACon', exact=False)).to_be_visible(timeout=15000)
                    step('alarm went off on the controller and was acknowledged from Alarms')

                    # ---- bulk: every operating mode into Standby, by label ----
                    page.get_by_role('button', name='Objects', exact=True).click()
                    page.locator('header button', has_text=re.compile('^All devices$')).click()  # every device, not just the one picked
                    search.fill('Operating mode')
                    search.press('Enter')
                    write_shown(page)  # tick every row shown, then Write in the bar over the table
                    expect(page.get_by_text('groups that take the same value', exact=False)).to_be_visible(timeout=30000)
                    sheet = page.get_by_role('dialog')
                    sections = sheet.locator('section')
                    for i in range(sections.count()):
                        sections.nth(i).get_by_role('switch').click()
                        sections.nth(i).get_by_role('radio', name='Standby').click()
                    page.screenshot(path=str(OUT / 'site-5-bulk-modes.png'))
                    page.get_by_role('button', name='Review', exact=True).click()
                    page.get_by_role('button', name=re.compile(r'^Send \d+ writes?$')).click()
                    expect(page.get_by_text(re.compile(r'^3 of 3 verified$'))).to_be_visible(timeout=60000)
                    page.get_by_role('button', name='Done').click()
                    step('bulk: 3 operating modes on 3 devices into Standby by label, 3 of 3 verified')

                    # ---- bulk: a property, the default of every setpoint ----
                    search.fill('setpoint')
                    search.press('Enter')
                    write_shown(page)  # tick every row shown, then Write in the bar over the table
                    page.get_by_role('combobox', name='Property to write').click()
                    page.get_by_role('option', name=re.compile('^Relinquish default')).click()
                    expect(page.get_by_text('groups that take the same value', exact=False)).to_be_visible(timeout=30000)
                    section = sheet.locator('section').first
                    section.get_by_role('switch').click()
                    section.get_by_role('spinbutton').fill('21.5')
                    page.screenshot(path=str(OUT / 'site-6-bulk-defaults.png'))
                    page.get_by_role('button', name='Review', exact=True).click()
                    page.wait_for_timeout(500)
                    page.screenshot(path=str(OUT / 'site-6b-bulk-defaults-review.png'))
                    page.get_by_role('button', name=re.compile(r'^Send \d+ writes?$')).click()
                    expect(page.get_by_text(re.compile(r'^(\d+) of \1 verified$'))).to_be_visible(timeout=60000)
                    page.get_by_role('button', name='Done').click()
                    step('bulk: relinquish default 21.5 on every setpoint, all verified')

                    # ---- a schedule's week ----
                    page.get_by_role('button', name='Schedules', exact=True).click()
                    page.get_by_role('button', name='Edit', exact=True).click()
                    expect(page.get_by_text('Monday', exact=True)).to_be_visible(timeout=30000)
                    page.get_by_role('button', name='Add a time on Saturday').click()
                    page.screenshot(path=str(OUT / 'site-7-schedule-edit.png'))
                    page.get_by_role('button', name='Review', exact=True).click()
                    page.get_by_role('button', name=re.compile(r'^Send \d+ changes?$')).click()
                    expect(page.get_by_text('Applied and verified.', exact=False)).to_be_visible(timeout=30000)
                    page.screenshot(path=str(OUT / 'site-8-schedule-saved.png'))
                    page.get_by_role('button', name='Done').click()
                    step('schedule: Saturday entry added, written and verified')

                    # ---- Activity: what BACon did; release everything it holds ----
                    page.get_by_role('button', name=re.compile('^Activity')).click()
                    expect(page.get_by_text(re.compile(r'BACon holds \d+ priority slots?'))).to_be_visible(timeout=15000)
                    page.get_by_role('button', name='Check live').click()
                    expect(page.get_by_text('still held').first).to_be_visible(timeout=30000)
                    page.screenshot(path=str(OUT / 'site-9-activity.png'))
                    page.get_by_role('button', name=re.compile(r'^Release all \d+')).click()
                    expect(page.get_by_text('BACon holds no priority slots', exact=False)).to_be_visible(timeout=60000)
                    step('Activity: every slot BACon held released')

                    # ---- undo every property change, newest first, from Activity ----
                    undone = 0
                    for _ in range(60):
                        log = http(BASE, 'GET', '/api/control/actions')['actions']
                        firsts = {}
                        for a in reversed(log):
                            if a['property'] not in ('present-value', 'acknowledge') and a['state'] == 'verified':
                                firsts.setdefault((a['key'], a['property']), a)
                        pending = [a for (k, prop), a in firsts.items() if before.get((k, prop)) is not None and
                                   prepare({x: a[x] for x in ('key', 'device', 'typeId', 'instance')}, prop)['current'] != before[(k, prop)]]
                        if not pending:
                            break
                        # the first change BACon made to it: its Undo puts back what was there before BACon arrived
                        target = pending[0]
                        row = page.locator(f'[data-action-id="{target["id"]}"]')
                        row.hover()
                        row.get_by_role('button', name='Undo').click()
                        expect(row.get_by_role('button', name='Undo')).to_be_enabled(timeout=30000)
                        page.wait_for_timeout(300)
                        undone += 1
                    page.screenshot(path=str(OUT / 'site-10-activity-after.png'))
                    step(f'Activity: {undone} property changes undone with Undo')

                    assert not errors, errors
                    browser.close()

                # the fan coils' modes went back to the controller when BACon released; the rest must match exactly
                after = snapshot()
                differ = [k for k in before if before[k] != after.get(k)]
                assert not differ, [(k, before[k], after.get(k)) for k in differ]
                log = http(BASE, 'GET', '/api/control/actions')
                assert not log['held'] and all(a['state'] != 'sending' for a in log['actions'])
                step(f"devices left as found: {len(before)} slots and properties match; {len(log['actions'])} actions logged, none unresolved")
            finally:
                server.terminate()
                server.wait(10)


if __name__ == '__main__':
    run()
