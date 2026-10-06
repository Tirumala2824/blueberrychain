"""Tiny .env reader for spike scripts (no third-party dependencies)."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


def load_env(path: Path = REPO_ROOT / ".env") -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.split(" #", 1)[0].strip().strip('"').strip("'")
    # real environment variables win over the file
    values.update({k: v for k, v in os.environ.items() if k.startswith(("BBC_", "SNOWFLAKE_"))})
    return values


def require(env: dict[str, str], *keys: str) -> None:
    missing = [k for k in keys if not env.get(k)]
    if missing:
        raise SystemExit(f"missing in .env: {', '.join(missing)} (see .env.example)")
