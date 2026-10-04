# /// script
# requires-python = ">=3.11"
# dependencies = ["edge-tts>=6.1", "imageio-ffmpeg>=0.5", "pillow>=10", "fonttools>=4.50",
#                 "snowflake-connector-python>=3.12", "cryptography>=42"]
# ///
"""Unattended demo build:  uv run demo/make_demo.py

  1 provision logger keys (not recorded)        5 compose the virtual-clock timeline
  2 synthesize voiceover per sentence           6 mix the narration track (WAV)
  3 record the real pipeline run, live          7 render frames -> H.264/AAC MP4
  4 fact-check narration vs Snowflake           8 verify 180-300 s and extract review frames

--reuse-cast re-renders from the last recording without re-running the pipeline.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE / "video"), str(HERE)]

import record  # noqa: E402
import render  # noqa: E402
import tts  # noqa: E402
from iot_ledger import common as c  # noqa: E402
from scenes import SCENES  # noqa: E402

BUILD = HERE / "build"
OUT = HERE / "out" / "blueberrychain_coco_demo.mp4"
PROMPT = "\x1b[92mdurga\x1b[0m@\x1b[96mcoco\x1b[0m \x1b[94m~/BlueberryChain\x1b[0m $ "
TITLE = "CoCo skills runner  —  BlueberryChain  ·  Snowflake account pndvhar-pt70809"
NARR_START, SENT_GAP = 0.6, 0.35
EXPECTED = {"records_in": 2169, "verified": 2161, "quarantined": 8, "anomalies": 5, "hold_kg": 2101}


def facts() -> dict:
    """Numbers the narration quotes, read back from Snowflake for the run that was recorded."""
    run_id = (c.RUNS_DIR / "LATEST").read_text().strip()
    conn = c.connect()
    cur = conn.cursor()
    cur.execute(f"SELECT RECORDS_VERIFIED, RECORDS_REJECTED, ANOMALIES, MERKLE_ROOT FROM {c.LEDGER}.ATTESTATIONS WHERE RUN_ID = %s", (run_id,))
    ok, bad, anom, root = cur.fetchone()
    cur.execute(f"SELECT COALESCE(SUM(SHIPPED_KG), 0) FROM {c.LEDGER}.V_SHIPMENT_TRUST WHERE RUN_ID = %s AND VERDICT = 'HOLD'", (run_id,))
    hold = cur.fetchone()[0]
    conn.close()
    return {"run_id": run_id, "records_in": int(ok + bad), "verified": int(ok), "quarantined": int(bad),
            "anomalies": int(anom), "hold_kg": int(round(float(hold))), "merkle_root": root}


def compose(cast: dict, voice: dict) -> dict:
    rng = random.Random(7)
    t, scenes, captions, clips = 0.0, [], [], []
    for sc in SCENES:
        narr, at = [], NARR_START
        for clip in voice[sc["id"]]:
            narr.append((at, clip))
            at += clip["seconds"] + SENT_GAP
        narr_end = at - SENT_GAP
        entry = {"id": sc["id"], "kind": sc["kind"], "phase": sc["phase"], "start": t, "writes": [],
                 "type_start": -1, "type_end": -1}
        if sc["kind"] == "card":
            if sc["id"] == "intro":
                entry["bullets"] = sc["bullets"]
                entry["_bullet_at"] = [a for a, _ in narr]
            dur = narr_end + 1.6
        else:
            w, tt = entry["writes"], 0.0
            w.append((0.0, "\x1b[2J\x1b[H" + PROMPT))
            tt = 0.9
            entry["type_start"] = tt
            for res in cast[sc["id"]]:
                for ch in res["cmd"]:
                    w.append((tt, ch))
                    tt += rng.uniform(0.03, 0.075) + (0.1 if ch == " " and rng.random() < 0.3 else 0)
                entry["type_end"] = tt
                tt += 0.45
                w.append((tt, "\n"))
                out_start = tt + 0.1
                # real timings, with connection waits capped so the pace stays brisk
                rel, prev_real, prev_rel = [], 0.0, 0.0
                for real, text in res["events"]:
                    prev_rel += min(real - prev_real, 1.6)
                    prev_real = real
                    rel.append((prev_rel, text))
                out_len = max(rel[-1][0], 0.1)
                scale = min(3.0, max(0.6, (NARR_START + 0.9 * (narr_end - NARR_START) - out_start) / out_len))
                for r, text in rel:
                    w.append((out_start + r * scale, text))
                tt = out_start + out_len * scale + 0.4
                w.append((tt, PROMPT))
            dur = max(narr_end + 1.6, tt + 2.0)
        entry["duration"] = dur
        for a, clip in narr:
            captions.append({"start": t + a, "end": t + a + clip["seconds"] + SENT_GAP * 0.8, "text": clip["caption"]})
            clips.append((t + a, clip["pcm"]))
        scenes.append(entry)
        t += dur
    return {"scenes": scenes, "captions": captions, "clips": clips, "duration": t}


def mix(timeline: dict, wav_path: Path) -> None:
    sr = tts.SAMPLE_RATE
    buf = bytearray(int((timeline["duration"] + 1) * sr) * 2)
    for start, pcm in timeline["clips"]:
        data = Path(pcm).read_bytes()
        off = int(start * sr) * 2
        buf[off:off + len(data)] = data
    with wave.open(str(wav_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(bytes(buf))


def probe_duration(path: Path) -> float:
    err = subprocess.run([tts.FFMPEG, "-i", str(path)], capture_output=True, text=True).stderr
    h, m, s = re.search(r"Duration: (\d+):(\d+):([\d.]+)", err).groups()
    return int(h) * 3600 + int(m) * 60 + float(s)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--reuse-cast", action="store_true")
    a = ap.parse_args()
    BUILD.mkdir(parents=True, exist_ok=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    print("[1/8] provisioning logger keys in LEDGER.DEVICE_REGISTRY")
    subprocess.run(["uv", "run", "--quiet", str(HERE / "bbc.py"), "setup"], check=True, cwd=HERE.parent,
                   env={**os.environ, "PYTHONIOENCODING": "utf-8"}, stdout=subprocess.DEVNULL)
    print("[2/8] synthesizing voiceover (edge-tts, %s)" % tts.VOICE)
    voice = tts.synthesize(BUILD)
    print(f"      {sum(len(v) for v in voice.values())} sentences, {sum(x['seconds'] for v in voice.values() for x in v):.1f}s of speech")
    if a.reuse_cast:
        print("[3/8] reusing recorded session")
        cast = json.loads((BUILD / "session.cast.json").read_text(encoding="utf-8"))
    else:
        print("[3/8] recording live pipeline run")
        cast = record.record(BUILD)
    print("[4/8] fact-checking narration against Snowflake")
    stats = facts()
    for k, v in EXPECTED.items():
        if stats[k] != v:
            raise SystemExit(f"narration says {k}={v} but recorded run has {stats[k]}; update scenes.py")
    print(f"      run {stats['run_id']}: {stats}")
    print("[5/8] composing timeline")
    tl = compose(cast, voice)
    for s in tl["scenes"]:
        print(f"      {s['id']:<9} {s['start']:6.1f}s  +{s['duration']:5.1f}s")
    print(f"      total {tl['duration']:.1f}s")
    if not 180 <= tl["duration"] <= 300:
        raise SystemExit("timeline outside 180-300 s; adjust narration")
    print("[6/8] mixing narration track")
    wav = BUILD / "narration.wav"
    mix(tl, wav)
    print("[7/8] rendering video")
    render.render(tl, OUT, wav, tts.FFMPEG, TITLE, stats)
    print("[8/8] verifying output")
    dur = probe_duration(OUT)
    frames = BUILD / "review"
    frames.mkdir(exist_ok=True)
    for s in tl["scenes"]:
        at = s["start"] + s["duration"] - 1.0
        subprocess.run([tts.FFMPEG, "-y", "-loglevel", "error", "-ss", f"{at:.2f}", "-i", str(OUT), "-frames:v", "1",
                        str(frames / f"{s['id']}.png")], check=True)
    ok = 180 <= dur <= 300
    print(f"      {OUT}  duration {dur:.2f}s  size {OUT.stat().st_size / 1e6:.1f} MB  -> {'PASS' if ok else 'FAIL'} (180-300 s)")
    if not ok:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
