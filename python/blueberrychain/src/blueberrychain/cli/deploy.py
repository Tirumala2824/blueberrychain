"""`bbc deploy python` - package bbc_toolkit / bbc_engine for Snowflake procedures.

Each package is zipped with its contracts bundled (``bbc_toolkit/_contracts``)
and uploaded to ``@BBC_OS.GOV.CODE/<package>/<version>/``; procedures import it
with ``IMPORTS = ('@BBC_OS.GOV.CODE/<package>/<version>/<package>.zip')``.
"""

from __future__ import annotations

import argparse
import importlib
import os
import shutil
import subprocess
import zipfile
from pathlib import Path

from bbc_toolkit import contracts

PACKAGES = ("bbc_toolkit", "bbc_engine")
DEFAULT_STAGE = "@BBC_OS.GOV.CODE"
DEFAULT_OUT = Path(".artifacts/deploy")
_FIXED_TIME = (2026, 1, 1, 0, 0, 0)  # deterministic zips: same sources -> same bytes


def _add(zf: zipfile.ZipFile, arcname: str, data: bytes) -> None:
    info = zipfile.ZipInfo(arcname, date_time=_FIXED_TIME)
    info.compress_type = zipfile.ZIP_DEFLATED
    zf.writestr(info, data)


def build_zip(package: str, out_dir: Path) -> Path:
    module = importlib.import_module(package)
    src = Path(module.__file__).parent
    version = module.__version__
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / f"{package}-{version}.zip"
    with zipfile.ZipFile(target, "w") as zf:
        for path in sorted(src.rglob("*.py")):
            if "__pycache__" in path.parts:
                continue
            _add(zf, f"{package}/{path.relative_to(src).as_posix()}", path.read_bytes())
        if package == "bbc_toolkit":
            root = Path(str(contracts.contracts_dir()))
            for sub in ("schemas", "vectors"):
                for path in sorted((root / sub).rglob("*.json")):
                    _add(
                        zf,
                        f"bbc_toolkit/_contracts/{sub}/{path.relative_to(root / sub).as_posix()}",
                        path.read_bytes(),
                    )
    return target


def upload(path: Path, package: str, version: str, stage: str, connection: str) -> None:
    exe = shutil.which("snow")
    if exe is None:
        raise RuntimeError("snow CLI not found on PATH")
    sql = (
        f"PUT 'file://{path.resolve().as_posix()}' {stage}/{package}/{version}/ "
        "AUTO_COMPRESS = FALSE OVERWRITE = TRUE"
    )
    env = {**os.environ, "PYTHONUTF8": "1"}
    proc = subprocess.run(
        [exe, "sql", "-c", connection, "-q", sql],
        capture_output=True,
        text=True,
        encoding="utf-8",
        env=env,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())


def add_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dry-run", action="store_true", help="Build the zips only.")
    parser.add_argument("--stage", default=DEFAULT_STAGE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument(
        "-c", "--connection", default=os.environ.get("BBC_CONNECTION", "pndvhar-pt70809")
    )


def run(args: argparse.Namespace) -> int:
    for package in PACKAGES:
        path = build_zip(package, args.out)
        version = importlib.import_module(package).__version__
        if args.dry_run:
            print(f"built    {path.as_posix()}")
            continue
        upload(path, package, version, args.stage, args.connection)
        print(f"uploaded {path.name} -> {args.stage}/{package}/{version}/")
    return 0
