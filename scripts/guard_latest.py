"""Keep GitHub's "latest" release on BACon.

    python scripts/guard_latest.py

This repo publishes two apps: BACon (tagged vX.Y.Z, carries BACon.exe) and Rasher (tagged rasher-vX.Y.Z). Copies of
BACon already out there, the README and the site's Download buttons all ask GitHub for releases/latest, so that must
always be the newest BACon release. This finds it and, if anything else is marked latest, moves the mark back.
Release scripts run it after publishing, and .github/workflows/guard-latest.yml runs it on every release event.
Standard library and gh only, so the Action needs nothing installed.
"""

import json
import os
import re
import subprocess
import sys

REPO = os.environ.get("GITHUB_REPOSITORY") or "TheeHappyCoder/BACon"
TAG = re.compile(r"v(\d+)\.(\d+)\.(\d+)")


def gh(*args) -> str:
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True).stdout


def newest_bacon(releases: list) -> str | None:
    ours = [
        r for r in releases
        if not r.get("draft") and not r.get("prerelease") and TAG.fullmatch(r.get("tag_name") or "")
        and any(a.get("name") == "BACon.exe" for a in r.get("assets") or [])
    ]
    best = max(ours, key=lambda r: tuple(map(int, TAG.fullmatch(r["tag_name"]).groups())), default=None)
    return best["tag_name"] if best else None


def main():
    want = newest_bacon(json.loads(gh("api", f"repos/{REPO}/releases?per_page=50")))
    if not want:
        print("No BACon release yet; nothing to guard.")
        return
    try:
        latest = json.loads(gh("api", f"repos/{REPO}/releases/latest"))["tag_name"]
    except subprocess.CalledProcessError:
        latest = None
    if latest == want:
        print(f"Latest is {want}, BACon's newest. All good.")
        return
    print(f"Latest is {latest or 'unset'}, but BACon's newest is {want}. Moving latest back to {want}.")
    gh("release", "edit", want, "--repo", REPO, "--latest")
    latest = json.loads(gh("api", f"repos/{REPO}/releases/latest"))["tag_name"]
    if latest != want:
        sys.exit(f"Couldn't move latest: it is still {latest}. Fix it by hand: gh release edit {want} --latest")
    print(f"Latest is {want} again.")


if __name__ == "__main__":
    main()
