"""Face regression checks: each profile's face and full view from frozen state, compared pixel for pixel.

    python rasher/tests/faces.py                 # compare with tests/faces/*.png
    python rasher/tests/faces.py --update        # write the baselines (only from a known-good commit)
    python rasher/tests/faces.py --capture       # new fixtures from a Rasher of its own (or --capture URL: a running one)

Build the UI first (cd rasher/web && npm run build). Each fixture (tests/fixtures/<type>/state.json and trend.json) is
served to the built UI by a stand-in API with the browser's clock frozen and animation off, and Chrome (Playwright)
screenshots the small window and the full view's tabs. Differences are written to tests/out/ next to what they should
be. Fonts and anti-aliasing differ between machines: on a new machine, run --update once from a known-good commit.
"""

import argparse
import json
import os
import sys
import threading
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(os.path.dirname(HERE), "src", "rasher", "web")
FIXTURES = os.path.join(HERE, "fixtures")
FACES = os.path.join(HERE, "faces")
OUT = os.path.join(HERE, "out")
TABS = ["Trends", "Network and faults", "Alarms", "Activity"]


def serve(state: dict, trend: dict) -> ThreadingHTTPServer:
    """The built UI, with an API that always answers with the fixture and a clock stopped just after its last entry."""
    stamps = [a["t"] for a in state.get("activity", [])] or [state["device"]["started"]]
    shim = (f"<script>(()=>{{const R=Date,T={int(max(stamps) * 1000) + 5000};"
            "class D extends R{constructor(...a){a.length?super(...a):super(T)}static now(){return T}};window.Date=D})()</script>")
    d = state["device"]
    devices = [{k: d[k] for k in ("instance", "name", "type", "ip", "port", "powered")}]

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *a, **k):
            super().__init__(*a, directory=WEB, **k)

        def log_message(self, *a):
            pass

        def send(self, body: bytes, kind: str):
            self.send_response(200)
            self.send_header("Content-Type", kind)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split("?")[0]
            if path.startswith("/api/"):
                if path.endswith("/state"):
                    body = {**state, "activity": state["activity"] if "since=0" in self.path else []}
                else:
                    body = trend if path.endswith("/trend") else devices if path == "/api/devices" else {}
                return self.send(json.dumps(body).encode(), "application/json")
            if path == "/" or not os.path.isfile(os.path.join(WEB, path.lstrip("/"))):
                with open(os.path.join(WEB, "index.html"), encoding="utf-8") as f:
                    return self.send(f.read().replace("<head>", "<head>" + shim, 1).encode(), "text/html")
            return super().do_GET()

        def do_POST(self):
            self.send(b'{"ok": true}', "application/json")

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def shoot(page, url: str) -> dict[str, bytes]:
    shots = {}
    page.set_viewport_size({"width": 372, "height": 640})
    page.goto(url)
    page.add_style_tag(content="*,*::before,*::after{animation:none!important;transition:none!important}")
    page.wait_for_timeout(2500)
    shots["compact"] = page.screenshot()
    page.set_viewport_size({"width": 1280, "height": 820})
    page.get_by_text("More", exact=True).click()
    page.wait_for_timeout(1500)
    shots["points"] = page.screenshot()
    for tab in TABS:
        page.get_by_role("tab", name=tab).click()
        page.wait_for_timeout(1500)
        shots[tab.split()[0].lower()] = page.screenshot()
    return shots


def capture(url: str | None, types: list[str] | None) -> None:
    """One device of each type becomes that type's fixture: from a running Rasher at url, or from one started for it,
    left a minute to settle."""
    if url is None:
        import time

        from bacnet import isolated

        with isolated(types=types) as (base, _):
            time.sleep(60)
            capture(base, types)
        return
    seen = set()
    for d in json.loads(urllib.request.urlopen(f"{url}/api/devices").read()):
        if d["type"] in seen or types and d["type"] not in types:
            continue
        seen.add(d["type"])
        folder = os.path.join(FIXTURES, d["type"])
        os.makedirs(folder, exist_ok=True)
        for name, path in (("state", f"/api/d/{d['instance']}/state"), ("trend", f"/api/d/{d['instance']}/trend?hours=24")):
            data = json.loads(urllib.request.urlopen(url + path).read())
            with open(os.path.join(folder, f"{name}.json"), "w", encoding="utf-8", newline="\n") as f:
                json.dump(data, f, ensure_ascii=False)
        print(f"captured {d['type']} from {d['name']}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--update", action="store_true", help="write the baselines instead of comparing")
    ap.add_argument("--capture", nargs="?", const="", help="new fixtures from a Rasher of its own, or from a running one at the URL given")
    ap.add_argument("--types", nargs="*", help="profile types to check (default: every fixture)")
    a = ap.parse_args()
    if a.capture is not None:
        capture(a.capture or None, a.types)
        return 0
    if not os.path.isfile(os.path.join(WEB, "index.html")):
        print("Build the UI first: cd rasher/web && npm run build")
        return 2

    from io import BytesIO

    from PIL import Image, ImageChops
    from playwright.sync_api import sync_playwright

    types = a.types or sorted(os.listdir(FIXTURES))
    os.makedirs(FACES, exist_ok=True)
    failed = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome")
        for kind in types:
            with open(os.path.join(FIXTURES, kind, "state.json"), encoding="utf-8") as f:
                state = json.load(f)
            with open(os.path.join(FIXTURES, kind, "trend.json"), encoding="utf-8") as f:
                trend = json.load(f)
            server = serve(state, trend)
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            shots = shoot(page, f"http://127.0.0.1:{server.server_address[1]}/?d={state['device']['instance']}")
            page.close()
            server.shutdown()
            if errors:
                failed.append(f"{kind}: page errors {errors[:2]}")
            for view, png in shots.items():
                name = f"{kind}-{view}.png"
                path = os.path.join(FACES, name)
                now = Image.open(BytesIO(png)).convert("RGB")
                if a.update:
                    now.save(path, optimize=True)
                    print(f"  wrote faces/{name}")
                    continue
                if not os.path.isfile(path):
                    failed.append(f"{name}: no baseline (run --update from a known-good commit)")
                    continue
                want = Image.open(path).convert("RGB")
                box = ImageChops.difference(want, now).getbbox() if want.size == now.size else (0, 0) + now.size
                if box:
                    os.makedirs(OUT, exist_ok=True)
                    now.save(os.path.join(OUT, name))
                    want.save(os.path.join(OUT, name.replace(".png", ".want.png")))
                    failed.append(f"{name}: differs in {box}, see tests/out/")
                print(f"  {'FAIL' if box else 'ok  '} {name}")
        browser.close()
    for line in failed:
        print("FAIL", line)
    print("Faces updated" if a.update else f"{'FAILED' if failed else 'All faces match'} ({len(types)} profiles)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
