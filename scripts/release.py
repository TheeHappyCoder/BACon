"""Publish a release: bump the version, build, tag, push and upload to GitHub Releases.

    python scripts/release.py 0.2.0 "What changed, one line per item"

The app's update button picks up the newest release (BACon.exe + BACon.exe.sha256). Needs git and gh.
"""

import os
import re
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VERSION_FILE = os.path.join(ROOT, "src", "bacon", "version.py")


def run(*cmd):
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=ROOT, check=True)


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r"\d+\.\d+\.\d+", sys.argv[1]):
        sys.exit(__doc__)
    version, notes = sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""
    if subprocess.run(["git", "status", "--porcelain"], cwd=ROOT, capture_output=True, text=True).stdout.strip():
        sys.exit("Commit or stash your changes first.")

    src = open(VERSION_FILE, encoding="utf-8").read()
    open(VERSION_FILE, "w", encoding="utf-8", newline="\n").write(
        re.sub(r'__version__ = "[^"]+"', f'__version__ = "{version}"', src)
    )

    run(sys.executable, os.path.join("scripts", "build.py"))
    run("git", "commit", "-am", f"Release {version}")
    run("git", "tag", f"v{version}")
    run("git", "push", "--follow-tags")
    run("gh", "release", "create", f"v{version}", "dist/BACon.exe", "dist/BACon.exe.sha256",
        "--title", f"BACon {version}", "--notes", notes or f"BACon {version}")


if __name__ == "__main__":
    main()
