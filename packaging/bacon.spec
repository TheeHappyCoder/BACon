# PyInstaller spec for BACon.exe. Build with: python scripts/build.py
import os

from PyInstaller.utils.hooks import collect_submodules

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
PKG = os.path.join(ROOT, "src", "bacon")

a = Analysis(
    [os.path.join(SPECPATH, "launch.py")],
    pathex=[os.path.join(ROOT, "src")],
    datas=[
        (os.path.join(PKG, "data"), "bacon/data"),
        (os.path.join(PKG, "web"), "bacon/web"),
    ],
    hiddenimports=collect_submodules("bacpypes3", filter=lambda m: not m.startswith(("bacpypes3.sc", "bacpypes3.rdf"))) + collect_submodules("uvicorn"),
    hookspath=[os.path.join(SPECPATH, "hooks")],
    excludes=["tkinter", "numpy", "matplotlib", "PIL", "pytest", "IPython"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    name="BACon",
    icon=os.path.join(SPECPATH, "icon.ico"),
    version=os.path.join(ROOT, "build", "version.txt"),
    console=False,
    upx=False,
)
