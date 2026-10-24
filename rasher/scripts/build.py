"""Build rasher/dist/Rasher.exe: the web UI, then the one-file exe.

    python rasher/scripts/build.py
"""

import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def run(*cmd, cwd=ROOT):
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, shell=os.name == "nt" and cmd[0] == "npm")


def main():
    web = os.path.join(ROOT, "web")
    for folder in (web, os.path.join(ROOT, "..", "web")):  # Rasher's UI imports BACon's design system
        if not os.path.isdir(os.path.join(folder, "node_modules")):
            run("npm", "ci", cwd=folder)
    run("npm", "run", "build", cwd=web)

    shutil.rmtree(os.path.join(ROOT, "dist"), ignore_errors=True)
    run(sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
        "--distpath", "dist", "--workpath", os.path.join("build", "pyinstaller"), os.path.join("packaging", "rasher.spec"))
    exe = os.path.join(ROOT, "dist", "Rasher.exe")
    print(f"\nRasher: {exe} ({os.path.getsize(exe) / 1048576:.1f} MB)")


if __name__ == "__main__":
    main()
