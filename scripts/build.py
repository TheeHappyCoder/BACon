"""Build dist/BACon.exe: the web UI, then the one-file exe, then its SHA-256.

    python scripts/build.py
"""

import hashlib
import os
import shutil
import subprocess
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT, "src"))

from bacon.version import __version__  # noqa: E402

VERSION_INFO = """VSVersionInfo(
  ffi=FixedFileInfo(filevers=({v}, 0), prodvers=({v}, 0)),
  kids=[
    StringFileInfo([StringTable('040904B0', [
      StringStruct('CompanyName', 'TheeHappyCoder'),
      StringStruct('FileDescription', 'BACon: BACnet, on site'),
      StringStruct('FileVersion', '{s}'),
      StringStruct('ProductName', 'BACon'),
      StringStruct('ProductVersion', '{s}'),
      StringStruct('OriginalFilename', 'BACon.exe'),
    ])]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])]),
  ],
)
"""


def run(*cmd, cwd=ROOT):
    print("+", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True, shell=os.name == "nt" and cmd[0] == "npm")


def main():
    web = os.path.join(ROOT, "web")
    if not os.path.isdir(os.path.join(web, "node_modules")):
        run("npm", "ci", cwd=web)
    run("npm", "run", "build", cwd=web)

    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    parts = [int(p) for p in __version__.split(".")][:3]
    with open(os.path.join(ROOT, "build", "version.txt"), "w", encoding="utf-8") as f:
        f.write(VERSION_INFO.format(v=", ".join(map(str, parts)), s=__version__))

    shutil.rmtree(os.path.join(ROOT, "dist"), ignore_errors=True)
    run(sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--log-level", "WARN",
        "--distpath", "dist", "--workpath", os.path.join("build", "pyinstaller"), os.path.join("packaging", "bacon.spec"))

    exe = os.path.join(ROOT, "dist", "BACon.exe")
    digest = hashlib.sha256(open(exe, "rb").read()).hexdigest()
    with open(exe + ".sha256", "w", encoding="ascii") as f:
        f.write(f"{digest}  BACon.exe\n")
    print(f"\nBACon {__version__}: {exe} ({os.path.getsize(exe) / 1048576:.1f} MB)\nsha256 {digest}")


if __name__ == "__main__":
    main()
