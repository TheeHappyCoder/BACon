"""Publish a Rasher release: bump the version, build, tag rasher-vX.Y.Z, push and upload to GitHub Releases.

    python rasher/scripts/release.py 0.1.0 "What changed, one line per item"

Rasher shares the BACon repo's releases, and BACon's updater, README and site all follow GitHub's "latest" release.
So a Rasher release is never marked latest: it is tagged rasher-vX.Y.Z, created with --latest=false, and then
scripts/guard_latest.py checks BACon still holds the mark (and puts it back if not). Needs git and gh.
"""

import hashlib
import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
VERSION_FILE = os.path.join(ROOT, "rasher", "src", "rasher", "version.py")
EXE = os.path.join("rasher", "dist", "Rasher.exe")


def run(*cmd):
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        sys.exit(__doc__)
    version, notes = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""
    tag = f"rasher-v{version}"
    if subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        sys.exit("Commit or stash your changes first.")

    src = open(VERSION_FILE, encoding="utf-8").read()
    open(VERSION_FILE, "w", encoding="utf-8", newline="\n").write(
        re.sub(r'__version__ = "[^"]+"', f'__version__ = "{version}"', src)
    )

    run(sys.executable, os.path.join("rasher", "scripts", "build.py"))
    exe = os.path.join(ROOT, EXE)
    with open(exe + ".sha256", "w", encoding="ascii") as f:
        f.write(f"{hashlib.sha256(open(exe, 'rb').read()).hexdigest()}  Rasher.exe\n")

    if subprocess.run(["git", "diff", "--quiet"], cwd=ROOT).returncode:  # the first release is already at its version
        run("git", "commit", "-am", f"Rasher release {version}")
    run("git", "tag", tag)
    run("git", "push", "--follow-tags")
    run("gh", "release", "create", tag, EXE, EXE + ".sha256",
        "--title", f"Rasher {version}", "--notes", notes or f"Rasher {version}", "--latest=false")
    run(sys.executable, os.path.join("scripts", "guard_latest.py"))


if __name__ == "__main__":
    main()
