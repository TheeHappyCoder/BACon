"""Remake the README's and the site's screenshots and GIFs from the app as it is now.

    python scripts/docs_media.py                 # everything
    python scripts/docs_media.py objects alarms  # some of them (names below)

Starts a Rasher of its own (three fan coils, a VAV and a meter on this PC's address, ports 47830 and up) and a BACon
backend of its own (HTTP 8071, UDP 47851, data in a temporary folder), so the copies you have open are left alone. It
reads the devices, starts a trend group, sets off an alarm and a fault, then drives the UI in Chrome:

    docs/images/objects.png, trends.png, network.png   1360 x 820 at 2x
    docs/gifs/<name>.gif                               960 x 600, a fake cursor so you can follow the clicks

and copies Rasher's faces (rasher/tests/faces, made by rasher/tests/faces.py) to docs/images/rasher.

Needs the built UI (cd web && npm run build), Rasher's backend packages, Playwright with Chrome, and Pillow.
"""

import asyncio
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

from PIL import Image
from playwright.async_api import async_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
DOCS = os.path.join(ROOT, "docs")
sys.path.insert(0, os.path.join(ROOT, "rasher", "tests"))
from bacnet import isolated  # noqa: E402  (Rasher's own test helper)

BACON = "http://127.0.0.1:8071"
UDP = 47851
RASHER_HTTP = 8061
SHOT = {"width": 1360, "height": 820}  # stills, at 2x
GIF_VIEW = {"width": 1440, "height": 900}  # recorded at this size, saved at 960 x 600
GIF_SIZE = (960, 600)
FRAME = 0.08  # seconds between frames

# a cursor drawn into the page, since screenshots leave the real one out; it ripples on each click
CURSOR = """
(() => {
  const c = document.createElement('div')
  c.id = 'doc-cursor'
  c.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-6.6L4 20z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  Object.assign(c.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647, pointerEvents: 'none', transition: 'transform 90ms ease' })
  const ring = document.createElement('div')
  Object.assign(ring.style, { position: 'fixed', width: '34px', height: '34px', marginLeft: '-17px', marginTop: '-17px', borderRadius: '999px', border: '2px solid #c6f56f', zIndex: 2147483646, pointerEvents: 'none', opacity: 0 })
  const add = () => { document.body.appendChild(c); document.body.appendChild(ring) }
  document.body ? add() : addEventListener('DOMContentLoaded', add)
  addEventListener('mousemove', (e) => { c.style.left = e.clientX - 3 + 'px'; c.style.top = e.clientY - 2 + 'px' }, true)
  addEventListener('mousedown', (e) => {
    c.style.transform = 'scale(0.86)'
    ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'
    ring.animate([{ opacity: 0.9, transform: 'scale(0.4)' }, { opacity: 0, transform: 'scale(1.4)' }], { duration: 420, easing: 'ease-out' })
  }, true)
  addEventListener('mouseup', () => { c.style.transform = 'scale(1)' }, true)
})()
"""


def http(method: str, path: str, body=None, base: str = BACON, timeout: float = 30):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def this_pc_ip() -> str:
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]


class Recorder:
    """Screenshots in the background while the page is driven, saved as a GIF with each frame held as long as it was
    on screen; frames that did not change are merged."""

    def __init__(self, page):
        self.page, self.frames, self.task = page, [], None

    async def _loop(self):
        while True:
            t = time.monotonic()
            png = await self.page.screenshot(type="png")  # lossless: JPEG noise would make every frame differ everywhere
            self.frames.append((t, png))
            await asyncio.sleep(max(0, FRAME - (time.monotonic() - t)))

    async def __aenter__(self):
        self.task = asyncio.create_task(self._loop())
        return self

    async def __aexit__(self, *exc):
        await asyncio.sleep(1.2)  # hold the last state for a moment
        self.task.cancel()
        try:
            await self.task
        except asyncio.CancelledError:
            pass

    def save(self, path: str):
        """One palette for every frame (from the first, middle and last), so the GIF stores only what changed from
        one frame to the next."""
        rgb = [(t, Image.open(io.BytesIO(raw)).convert("RGB").resize(GIF_SIZE, Image.LANCZOS)) for t, raw in self.frames]
        sample = [rgb[0][1], rgb[len(rgb) // 2][1], rgb[-1][1]]
        sheet = Image.new("RGB", (GIF_SIZE[0], GIF_SIZE[1] * len(sample)))
        for k, im in enumerate(sample):
            sheet.paste(im, (0, GIF_SIZE[1] * k))
        palette = sheet.quantize(colors=255, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        images, durations, last = [], [], None
        for i, (t, im) in enumerate(rgb):
            nxt = rgb[i + 1][0] if i + 1 < len(rgb) else t + 1.6
            ms = max(40, int((nxt - t) * 1000))
            frame = im.quantize(palette=palette, dither=Image.Dither.NONE)
            key = frame.tobytes()
            if key == last:
                durations[-1] += ms
                continue
            last = key
            images.append(frame)
            durations.append(ms)
        images[0].save(path, save_all=True, append_images=images[1:], duration=durations, loop=0, optimize=False, disposal=1)
        print(f"  {os.path.relpath(path, ROOT)}: {len(images)} frames, {os.path.getsize(path) // 1024} KB, {sum(durations) / 1000:.1f} s")


async def glide(page, locator, click=True):
    """Move the cursor to the element the way a hand would, then click it."""
    await locator.scroll_into_view_if_needed()
    box = await locator.bounding_box()
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    await page.mouse.move(x, y, steps=14)
    await page.wait_for_timeout(120)
    if click:
        await page.mouse.down()
        await page.wait_for_timeout(70)
        await page.mouse.up()
        await page.wait_for_timeout(250)


async def typed(page, text: str):
    await page.keyboard.type(text, delay=55)


async def open_app(browser, view, scale=1):
    ctx = await browser.new_context(viewport=view, device_scale_factor=scale)
    await ctx.add_init_script(CURSOR)
    page = await ctx.new_page()
    await page.goto(BACON)
    await page.wait_for_timeout(2500)
    await page.keyboard.press("Escape")
    await page.mouse.move(view["width"] * 0.62, view["height"] * 0.5)
    return ctx, page


async def place(page, name: str):
    await page.get_by_role("navigation", name="Places").get_by_role("button", name=name, exact=False).first.click()
    await page.wait_for_timeout(1200)


def row(page, name: str):
    return page.locator("[data-row-key]", has_text=name).first


# ---- the scenes ----------------------------------------------------------------------------------------------


async def shot_objects(browser, out):
    ctx, page = await open_app(browser, SHOT, 2)
    for name in ["Room temperature", "Outside air temperature", "Room CO2"]:
        await row(page, name).get_by_role("checkbox").click()
    await row(page, "Comfort setpoint").get_by_text("Comfort setpoint", exact=True).click()
    await page.wait_for_timeout(1800)
    await page.mouse.move(-10, -10)
    await page.screenshot(path=os.path.join(out, "objects.png"))
    await ctx.close()


async def shot_trends(browser, out):
    ctx, page = await open_app(browser, SHOT, 2)
    await place(page, "Trends")
    await page.get_by_role("tab", name="6 hours").click()
    await page.wait_for_timeout(3000)
    await page.mouse.move(SHOT["width"] * 0.8, 330)
    await page.wait_for_timeout(500)
    await page.screenshot(path=os.path.join(out, "trends.png"))
    await ctx.close()


async def shot_network(browser, out):
    ctx, page = await open_app(browser, SHOT, 2)
    await place(page, "Network")
    await page.wait_for_timeout(4000)
    await page.mouse.move(-10, -10)
    await page.screenshot(path=os.path.join(out, "network.png"))
    await ctx.close()


async def gif_query(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    field = page.get_by_placeholder("Search, or type a filter")
    async with Recorder(page) as rec:
        await glide(page, field)
        await typed(page, "status-flags has fault")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(1800)
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await typed(page, "present-value > 25 and units = percent")
        await page.keyboard.press("Enter")
        await page.wait_for_timeout(2000)
    rec.save(os.path.join(out, "query.gif"))
    await ctx.close()


async def gif_health(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    async with Recorder(page) as rec:
        await glide(page, page.get_by_role("tab", name="Health"))
        await page.wait_for_timeout(1500)
        await page.mouse.move(700, 600, steps=10)
        await page.mouse.wheel(0, 380)
        await page.wait_for_timeout(1200)
        await page.mouse.wheel(0, 500)
        await page.wait_for_timeout(1400)
    rec.save(os.path.join(out, "health.gif"))
    await ctx.close()


async def gif_export(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    async with Recorder(page) as rec:
        for name in ["Room temperature", "Room humidity", "Room CO2"]:
            await glide(page, row(page, name).get_by_role("checkbox"))
        await page.wait_for_timeout(500)
        await glide(page, page.get_by_role("button", name="Columns"))
        await page.wait_for_timeout(1400)
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)
        await glide(page, page.get_by_role("toolbar", name="Ticked rows").get_by_role("button", name="Export"))
        await page.wait_for_timeout(1300)
        await glide(page, page.get_by_role("radio", name="All"), click=True)
        await page.wait_for_timeout(700)
        await glide(page, page.get_by_role("radio", name="ticked"), click=True)
        await page.wait_for_timeout(900)
    rec.save(os.path.join(out, "export.gif"))
    await ctx.close()


async def gif_write(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    field = page.get_by_placeholder("Search, or type a filter")
    async with Recorder(page) as rec:
        await glide(page, field)
        await typed(page, "Comfort setpoint")
        await page.wait_for_timeout(700)
        await glide(page, page.get_by_role("checkbox", name="Tick every row shown"))
        await page.wait_for_timeout(500)
        await glide(page, page.get_by_role("toolbar", name="Ticked rows").get_by_role("button", name="Write"))
        await page.wait_for_timeout(2600)
        sheet = page.get_by_role("dialog")
        await glide(page, sheet.locator("section").first.get_by_role("switch"))
        await page.wait_for_timeout(400)
        await glide(page, sheet.get_by_role("spinbutton").first)
        await typed(page, "21.5")
        await page.wait_for_timeout(600)
        await glide(page, page.get_by_role("button", name="Review", exact=True))
        await page.wait_for_timeout(1300)
        await glide(page, page.get_by_role("button", name="Send", exact=False))
        await page.wait_for_timeout(4500)
    rec.save(os.path.join(out, "write.gif"))
    await ctx.close()


async def gif_trendlog(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    field = page.get_by_placeholder("Search, or type a filter")
    async with Recorder(page) as rec:
        await glide(page, field)
        await typed(page, "log")
        await page.wait_for_timeout(700)
        await glide(page, page.get_by_role("checkbox", name="Tick every row shown"))
        await glide(page, page.get_by_role("toolbar", name="Ticked rows").get_by_role("button", name="Trend"))
        await page.wait_for_timeout(900)
        await glide(page, page.get_by_role("radio", name="New group"))
        await glide(page, page.get_by_placeholder("Chiller 1"))
        await typed(page, "Trend logs")
        await page.wait_for_timeout(400)
        await glide(page, page.get_by_role("button", name="Make group and add"))
        await page.wait_for_timeout(900)
        await glide(page, page.get_by_role("navigation", name="Places").get_by_role("button", name="Trends", exact=False).first)
        await page.wait_for_timeout(1500)
        await glide(page, page.get_by_role("button", name="Trend logs"))
        await page.wait_for_timeout(1200)
        await glide(page, page.get_by_role("tab", name="24 hours"))
        await page.wait_for_timeout(2500)
        for x in (900, 1050, 1200, 1350):
            await page.mouse.move(x, 420, steps=8)
            await page.wait_for_timeout(250)
    rec.save(os.path.join(out, "trendlog.gif"))
    await ctx.close()


async def gif_schedules(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    async with Recorder(page) as rec:
        await glide(page, page.get_by_role("navigation", name="Places").get_by_role("button", name="Schedules"))
        await page.wait_for_timeout(2200)
        await glide(page, page.get_by_role("tab", name="Month").or_(page.get_by_role("radio", name="Month")).or_(page.get_by_role("button", name="Month")).first)
        await page.wait_for_timeout(2200)
        await glide(page, page.get_by_role("tab", name="Week").or_(page.get_by_role("radio", name="Week")).or_(page.get_by_role("button", name="Week")).first)
        await page.wait_for_timeout(1500)
    rec.save(os.path.join(out, "schedules.gif"))
    await ctx.close()


async def gif_alarms(browser, out):
    ctx, page = await open_app(browser, GIF_VIEW)
    async with Recorder(page) as rec:
        await glide(page, page.get_by_role("navigation", name="Places").get_by_role("button", name="Alarms", exact=False).first)
        await page.wait_for_timeout(2500)
        first = page.locator("main section button[aria-pressed]").first
        await glide(page, first)
        await page.wait_for_timeout(2200)
        await page.mouse.move(1300, 600, steps=10)
        await page.mouse.wheel(0, 420)
        await page.wait_for_timeout(1500)
    rec.save(os.path.join(out, "alarms.gif"))
    await ctx.close()


SCENES = {
    "objects": (shot_objects, "images"), "trends": (shot_trends, "images"), "network": (shot_network, "images"),
    "query": (gif_query, "gifs"), "health": (gif_health, "gifs"), "export": (gif_export, "gifs"), "write": (gif_write, "gifs"),
    "trendlog": (gif_trendlog, "gifs"), "schedules": (gif_schedules, "gifs"), "alarms": (gif_alarms, "gifs"),
}


# ---- the site to film ---------------------------------------------------------------------------------------


def stage(devices: list[dict], rasher: str):
    """Connect BACon, add and read every device, record a trend group, and give Alarms and Health something to show."""
    ip = this_pc_ip()
    http("POST", "/api/connect", {"ip": ip, "prefix": 24, "port": UDP})
    for d in devices:
        http("POST", "/api/devices/add", {"address": f"{ip}:{d['port']}"})
    http("POST", "/api/read", {"devices": [d["instance"] for d in devices], "retryFailed": False})
    for _ in range(180):
        if not any(j["state"] == "running" for j in http("GET", "/api/jobs")):
            break
        time.sleep(1)
    fcus = [d for d in devices if d["type"] == "fcu"]
    # something for Alarms and Health: a room too warm, a window open, a broken sensor, an override left in
    http("POST", f"/api/d/{fcus[0]['instance']}/control", {"action": "temp", "value": 27.5}, base=rasher)
    http("POST", f"/api/d/{fcus[1]['instance']}/control", {"action": "window", "value": True}, base=rasher)
    http("POST", f"/api/d/{fcus[2]['instance']}/control", {"action": "fault", "name": "sensor", "value": True}, base=rasher)
    http("POST", f"/api/d/{fcus[1]['instance']}/control", {"action": "write", "key": "analog-output,1", "value": 60, "priority": 8}, base=rasher)
    # a trend group of the rooms, recording
    rows = []
    for d in fcus:
        objs = {o["key"]: o for o in http("GET", f"/api/devices/{d['instance']}/objects")}
        for key in (f"{d['instance']}:0,1", f"{d['instance']}:2,3", f"{d['instance']}:4,1", f"{d['instance']}:3,2"):
            if key in objs:
                rows.append(objs[key])
    res = http("POST", "/api/trends/groups", {"name": "Meeting rooms", "interval": 10, "mode": "auto", "objects": rows})
    http("POST", f"/api/trends/groups/{res['group']}/start")
    print("  waiting a minute for alarms, live values and the trend to fill in…", flush=True)
    time.sleep(70)
    http("POST", "/api/read", {"devices": [d["instance"] for d in devices], "retryFailed": False})
    time.sleep(15)


async def film(names: list[str]):
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome")
        for name in names:
            fn, folder = SCENES[name]
            print(f"  {name}…", flush=True)
            await fn(browser, os.path.join(DOCS, folder))
        await browser.close()


def main():
    names = sys.argv[1:] or list(SCENES)
    unknown = [n for n in names if n not in SCENES]
    if unknown:
        sys.exit(f"Unknown: {', '.join(unknown)}. Choose from {', '.join(SCENES)}.")
    home = tempfile.mkdtemp(prefix="bacon-docs-")
    env = {**os.environ, "LOCALAPPDATA": home}
    bacon = subprocess.Popen([sys.executable, "-m", "uvicorn", "bacon.server:app", "--host", "127.0.0.1", "--port", BACON.rsplit(":", 1)[1]],
                             cwd=ROOT, env=env, stdout=open(os.path.join(home, "bacon.out"), "w"), stderr=subprocess.STDOUT)
    try:
        for _ in range(60):
            try:
                http("GET", "/api/status", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        with isolated(http_port=RASHER_HTTP, types=["fcu", "fcu", "fcu", "vav", "meter"], instance=2101) as (rasher, devices):
            stage(devices, rasher)
            asyncio.run(film(names))
    finally:
        bacon.terminate()
        bacon.wait(10)
    # Rasher's pictures on the site are its faces, kept current by rasher/tests/faces.py
    faces = os.path.join(ROOT, "rasher", "tests", "faces")
    for name in os.listdir(os.path.join(DOCS, "images", "rasher")):
        if os.path.exists(os.path.join(faces, name)):
            shutil.copyfile(os.path.join(faces, name), os.path.join(DOCS, "images", "rasher", name))
    print("Done. Look them over before committing.")


if __name__ == "__main__":
    main()
