"""Voiceover: one edge-tts clip per sentence, decoded to 24 kHz mono PCM for exact timing."""
from __future__ import annotations

import asyncio
import hashlib
import subprocess
from pathlib import Path

import edge_tts
import imageio_ffmpeg

from scenes import RATE, SCENES, VOICE

SAMPLE_RATE = 24000
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()


def spoken(s) -> str:
    return s[1] if isinstance(s, tuple) else s


def caption(s) -> str:
    return s[0] if isinstance(s, tuple) else s


async def _synth(text: str, mp3: Path, sem: asyncio.Semaphore) -> None:
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(mp3))
                return
            except Exception:
                if attempt == 3:
                    raise
                await asyncio.sleep(2 * (attempt + 1))


def synthesize(build: Path) -> dict[str, list[dict]]:
    """Returns {scene_id: [{caption, pcm, seconds}, ...]}. Clips are cached by text hash."""
    tts_dir = build / "tts"
    tts_dir.mkdir(parents=True, exist_ok=True)
    jobs, plan = [], {}
    for sc in SCENES:
        plan[sc["id"]] = []
        for s in sc["say"]:
            h = hashlib.sha1(f"{VOICE}|{RATE}|{spoken(s)}".encode()).hexdigest()[:12]
            mp3, pcm = tts_dir / f"{h}.mp3", tts_dir / f"{h}.pcm"
            if not pcm.exists():
                jobs.append((spoken(s), mp3))
            plan[sc["id"]].append({"caption": caption(s), "mp3": mp3, "pcm": pcm})

    async def run_all():
        sem = asyncio.Semaphore(4)
        await asyncio.gather(*(_synth(t, p, sem) for t, p in jobs))
    if jobs:
        asyncio.run(run_all())

    for clips in plan.values():
        for clip in clips:
            if not clip["pcm"].exists():
                subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-i", str(clip["mp3"]), "-ac", "1", "-ar", str(SAMPLE_RATE),
                                "-f", "s16le", str(clip["pcm"])], check=True)
            clip["seconds"] = clip["pcm"].stat().st_size / 2 / SAMPLE_RATE
    return plan
