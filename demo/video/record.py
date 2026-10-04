"""Headless terminal recorder.

Windows has no pty, so each command runs as a subprocess with stdout on a pipe; a reader thread
timestamps every chunk as it arrives (asciicast v2 style: [t, "o", text]). The command typed on
screen is exactly the command executed. stderr (uv / connector logs) goes to a side log, and any
non-zero exit aborts the build so a failed run can never end up in the video.
"""
from __future__ import annotations

import codecs
import json
import os
import shlex
import subprocess
import threading
import time
from pathlib import Path

from scenes import SCENES

REPO = Path(__file__).resolve().parents[2]


def run_command(cmd: str, log) -> dict:
    env = dict(os.environ, BBC_PACE="1", PYTHONIOENCODING="utf-8", PYTHONUNBUFFERED="1")
    t0 = time.monotonic()
    proc = subprocess.Popen(shlex.split(cmd), cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    events, dec = [], codecs.getincrementaldecoder("utf-8")(errors="replace")

    def pump_err():
        for line in proc.stderr:
            log.write(line.decode("utf-8", "replace"))

    th = threading.Thread(target=pump_err, daemon=True)
    th.start()
    while True:
        chunk = proc.stdout.read1(4096)
        if not chunk:
            break
        text = dec.decode(chunk)
        if text:
            events.append([round(time.monotonic() - t0, 3), text])
    proc.wait()
    th.join(timeout=5)
    return {"cmd": cmd, "events": events, "returncode": proc.returncode, "elapsed": round(time.monotonic() - t0, 3)}


def record(build: Path) -> dict:
    cast = {}
    with (build / "record_stderr.log").open("w", encoding="utf-8") as log:
        for sc in SCENES:
            if sc["kind"] != "term":
                continue
            cast[sc["id"]] = []
            for cmd in sc["commands"]:
                print(f"  [rec] {sc['id']:<9} $ {cmd}", flush=True)
                res = run_command(cmd, log)
                if res["returncode"] != 0:
                    raise SystemExit(f"command failed ({res['returncode']}): {cmd}  -> see {build / 'record_stderr.log'}")
                cast[sc["id"]].append(res)
    (build / "session.cast.json").write_text(json.dumps(cast, ensure_ascii=False), encoding="utf-8")
    return cast
