"""Shared primitives for the BlueberryChain IoT ledger skills.

Ledger rules (applied identically by the gateway that writes and the validator that checks):
  entry_hash = sha256( canonical_json(payload) )      payload includes prev_hash
  signature  = Ed25519_sign(device_key, bytes.fromhex(entry_hash))
  prev_hash  = entry_hash of the device's previous reading (GENESIS_HASH for seq 1)
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

DEMO_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = DEMO_DIR.parent
RUNS_DIR = DEMO_DIR / "out" / "runs"
CONNECTION = os.environ.get("BBC_CONNECTION", "pndvhar-pt70809")
LEDGER = "BLUEBERRY_CHAIN.LEDGER"

TEMP_LIMIT_C = 1.8          # same contract as TEMPERATURE_COMPLIANCE_PCT in the semantic view
INTERVAL_MIN = 2            # logger reporting interval
PAYLOAD_FIELDS = ("event_id", "device_id", "shipment_id", "seq", "ts", "lat", "lon",
                  "pulp_temp_c", "return_air_c", "door_open", "prev_hash")

# Pace of on-screen progress animation. 0 disables sleeps (tests / CI).
PACE = float(os.environ.get("BBC_PACE", "1"))


# ---------------------------------------------------------------- hashing / keys
def canonical(obj) -> bytes:
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode()


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def payload_of(rec: dict) -> dict:
    return {k: rec.get(k) for k in PAYLOAD_FIELDS}


def entry_hash(rec: dict) -> str:
    return sha256_hex(canonical(payload_of(rec)))


def genesis_hash(device_id: str) -> str:
    return sha256_hex(f"genesis:{device_id}".encode())


def device_key(device_id: str) -> Ed25519PrivateKey:
    # DEMO ONLY: deterministic keys so the recorded run is reproducible.
    # Real loggers generate the key in a secure element and only export the public half.
    return Ed25519PrivateKey.from_private_bytes(hashlib.sha256(f"bbc-demo-key:{device_id}".encode()).digest())


def pubkey_hex(key: Ed25519PrivateKey) -> str:
    return key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw).hex()


def verify_sig(pub_hex: str, sig_hex: str, msg_hex: str) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex)).verify(bytes.fromhex(sig_hex), bytes.fromhex(msg_hex))
        return True
    except Exception:
        return False


def merkle_root(hashes: list[str]) -> str:
    level = [bytes.fromhex(h) for h in hashes] or [b"\x00" * 32]
    while len(level) > 1:
        if len(level) % 2:
            level.append(level[-1])
        level = [hashlib.sha256(level[i] + level[i + 1]).digest() for i in range(0, len(level), 2)]
    return level[0].hex()


# ---------------------------------------------------------------- run folders
def run_dir(run_id: str) -> Path:
    if run_id == "latest":
        run_id = (RUNS_DIR / "LATEST").read_text().strip()
    d = RUNS_DIR / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def write_jsonl(path: Path, rows) -> None:
    with path.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------- snowflake
def connect():
    import snowflake.connector
    return snowflake.connector.connect(connection_name=CONNECTION, warehouse="BBC_WH",
                                       database="BLUEBERRY_CHAIN", schema="LEDGER",
                                       session_parameters={"QUERY_TAG": "bbc-iot-ledger-demo"})


# ---------------------------------------------------------------- terminal UI
RESET, BOLD, DIM = "\x1b[0m", "\x1b[1m", "\x1b[2m"
RED, GREEN, YELLOW, BLUE, MAGENTA, CYAN, WHITE = (f"\x1b[{c}m" for c in (91, 92, 93, 94, 95, 96, 97))
SEV_COLOR = {"CRITICAL": RED + BOLD, "HIGH": RED, "WARN": YELLOW, "INFO": CYAN}
VERDICT_COLOR = {"HOLD": RED + BOLD, "INSPECT": YELLOW + BOLD, "RELEASE": GREEN + BOLD}


def out(s: str = "") -> None:
    sys.stdout.write(s + "\n")
    sys.stdout.flush()


def pause(seconds: float) -> None:
    if PACE > 0:
        time.sleep(seconds * PACE)


def banner(step: str, title: str, subtitle: str) -> None:
    width = 104
    out(f"{MAGENTA}{BOLD}╔{'═' * width}╗{RESET}")
    out(f"{MAGENTA}{BOLD}║{RESET} {BOLD}{WHITE}{step:<12}{RESET}{CYAN}{BOLD}{title:<{width - 13}}{RESET}{MAGENTA}{BOLD}║{RESET}")
    out(f"{MAGENTA}{BOLD}║{RESET} {DIM}{subtitle:<{width - 1}}{RESET}{MAGENTA}{BOLD}║{RESET}")
    out(f"{MAGENTA}{BOLD}╚{'═' * width}╝{RESET}")


def section(text: str) -> None:
    out(f"\n{BLUE}{BOLD}► {text}{RESET}")


def ok(text: str) -> None:
    out(f"  {GREEN}✔{RESET} {text}")


def bad(text: str) -> None:
    out(f"  {RED}✖{RESET} {text}")


def warn(text: str) -> None:
    out(f"  {YELLOW}▲{RESET} {text}")


def info(text: str) -> None:
    out(f"  {DIM}·{RESET} {text}")


def progress(label: str, done: int, total: int, extra: str = "", width: int = 40) -> None:
    frac = done / total if total else 1.0
    filled = int(width * frac)
    bar = f"{GREEN}{'█' * filled}{DIM}{'░' * (width - filled)}{RESET}"
    end = "\n" if done >= total else ""
    sys.stdout.write(f"\r  {label:<22} {bar} {frac * 100:5.1f}%  {done:>5}/{total:<5} {extra}\x1b[K{end}")
    sys.stdout.flush()


def status_line(stage_states: dict[str, str]) -> None:
    """One-line pipeline status bar: INPUT → VALIDATE → DETECT → SYNC."""
    icons = {"done": f"{GREEN}■", "run": f"{YELLOW}►", "todo": f"{DIM}□"}
    parts = [f"{icons[s]} {name}{RESET}" for name, s in stage_states.items()]
    out(f"\n  {DIM}pipeline{RESET}  " + f"  {DIM}──{RESET}  ".join(parts))


def table(headers: list[str], rows: list[list], colors: list | None = None) -> None:
    widths = [max(len(str(h)), *(len(str(r[i])) for r in rows)) for i, h in enumerate(headers)]
    line = "  ┌" + "┬".join("─" * (w + 2) for w in widths) + "┐"
    out(DIM + line + RESET)
    out("  " + DIM + "│" + RESET + (DIM + "│" + RESET).join(f" {BOLD}{h:<{w}}{RESET} " for h, w in zip(headers, widths)) + DIM + "│" + RESET)
    out(DIM + "  ├" + "┼".join("─" * (w + 2) for w in widths) + "┤" + RESET)
    for ri, r in enumerate(rows):
        cells = []
        for ci, (v, w) in enumerate(zip(r, widths)):
            c = (colors[ri][ci] if colors and colors[ri] and colors[ri][ci] else "")
            txt = f"{v:>{w}}" if isinstance(v, (int, float)) else f"{v:<{w}}"
            cells.append(f" {c}{txt}{RESET} ")
        out("  " + DIM + "│" + RESET + (DIM + "│" + RESET).join(cells) + DIM + "│" + RESET)
    out(DIM + "  └" + "┴".join("─" * (w + 2) for w in widths) + "┘" + RESET)
