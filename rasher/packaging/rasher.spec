# PyInstaller spec for Rasher.exe. Build with: python rasher/scripts/build.py
import os

from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
PKG = os.path.join(ROOT, "src", "rasher")

a = Analysis(
    [os.path.join(SPECPATH, "launch.py")],
    pathex=[os.path.join(ROOT, "src")],
    datas=[(os.path.join(PKG, "web"), "rasher/web")],
    hiddenimports=collect_submodules("bacpypes3", filter=lambda m: not m.startswith(("bacpypes3.sc", "bacpypes3.rdf"))) + collect_submodules("uvicorn"),
    excludes=["tkinter", "numpy", "matplotlib", "PIL", "pytest", "IPython"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="Rasher",
    icon=os.path.join(SPECPATH, "icon.ico"),
    console=False,
    upx=False,
    # adding an address to the network adapter needs administrator rights: ask once, at launch
    uac_admin=True,
)
