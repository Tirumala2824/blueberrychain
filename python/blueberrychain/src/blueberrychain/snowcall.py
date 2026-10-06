"""Run a single SQL statement as a chosen identity.

* ``builder`` - the snow CLI named connection (the developer / CoCo session user).
* a persona (``govadmin``, ``quality``, ``sales``, ``finance``, ``auditor``) - the
  Snowflake SQL API with that user's role-restricted PAT from ``.env``, so every
  call is attributed to that user (separation of duties is real, not simulated).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

PERSONAS: dict[str, tuple[str, str]] = {
    "govadmin": ("BBC_GOVADMIN_PAT", "BBC_GOVERNANCE_ADMIN"),
    "quality": ("BBC_QUALITY_PAT", "BBC_QUALITY_MGR"),
    "sales": ("BBC_SALES_PAT", "BBC_SALES_MGR"),
    "finance": ("BBC_FINANCE_PAT", "BBC_FINANCE_MGR"),
    "auditor": ("BBC_AUDITOR_PAT", "BBC_AUDITOR"),
}
IDENTITIES = ["builder", *PERSONAS]

Runner = Callable[[str, list[Any]], list[list[Any]]]


def load_env(path: Path = Path(".env")) -> dict[str, str]:
    values: dict[str, str] = {}
    if path.exists():
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                values[key.strip()] = value.split(" #", 1)[0].strip().strip('"').strip("'")
    values.update({k: v for k, v in os.environ.items() if k.startswith(("BBC_", "SNOWFLAKE_"))})
    return values


def _literal(value: Any) -> str:
    """SQL literal for the builder path (snow CLI cannot bind)."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, int | float):
        return repr(value)
    text = str(value)
    if "$$" in text:
        raise ValueError("value contains '$$' and cannot be dollar-quoted")
    return f"$${text}$$"


def render(statement: str, params: list[Any]) -> str:
    parts = statement.split("?")
    if len(parts) - 1 != len(params):
        raise ValueError(f"statement has {len(parts) - 1} placeholders but {len(params)} params")
    out = parts[0]
    for part, value in zip(parts[1:], params, strict=True):
        out += _literal(value) + part
    return out


def snow_runner(connection: str) -> Runner:
    exe = shutil.which("snow")
    if exe is None:
        raise RuntimeError("snow CLI not found on PATH")

    def run(statement: str, params: list[Any]) -> list[list[Any]]:
        # A file, not -q: payloads can exceed the Windows command-line limit. Templating
        # is off so that payload text such as "&{...}" or "<% %>" reaches Snowflake as is.
        with tempfile.NamedTemporaryFile(
            "w", suffix=".sql", encoding="utf-8", delete=False
        ) as handle:
            handle.write(render(statement, params))
        try:
            proc = subprocess.run(
                [
                    exe,
                    "sql",
                    "-c",
                    connection,
                    "--format",
                    "json",
                    "--enable-templating",
                    "NONE",
                    "-f",
                    handle.name,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
                check=False,
                env={**os.environ, "PYTHONUTF8": "1"},
            )
        finally:
            os.unlink(handle.name)
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr.strip() or proc.stdout.strip())
        rows = json.loads(proc.stdout)
        if rows and isinstance(rows[0], list):
            rows = rows[-1]
        return [list(r.values()) for r in rows]

    return run


def sqlapi_runner(env: dict[str, str], pat_var: str, role: str, timeout_s: int = 120) -> Runner:
    token = env.get(pat_var)
    if not token:
        raise RuntimeError(f"{pat_var} is not set in .env (see snowflake/modules/00b_tokens.sql)")
    host = env.get("SNOWFLAKE_HOST") or f"{env['SNOWFLAKE_ACCOUNT']}.snowflakecomputing.com"
    headers = {
        "Authorization": f"Bearer {token}",
        "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    def _request(url: str, body: dict | None) -> dict:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            url, data=data, headers=headers, method="POST" if body else "GET"
        )
        try:
            with urllib.request.urlopen(request, timeout=timeout_s) as response:
                return json.loads(response.read() or b"{}") | {"_status": response.status}
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")
            raise RuntimeError(f"SQL API {exc.code}: {detail[:500]}") from None

    def run(statement: str, params: list[Any]) -> list[list[Any]]:
        body = {
            "statement": statement,
            "timeout": timeout_s,
            "database": env.get("BBC_DATABASE", "BBC_OS"),
            "warehouse": env.get("BBC_APP_WAREHOUSE", "BBC_APP_WH"),
            "role": role,
            "bindings": {
                str(i): {
                    "type": "TEXT",
                    "value": None
                    if v is None
                    else (json.dumps(v) if isinstance(v, dict | list) else str(v)),
                }
                for i, v in enumerate(params, start=1)
            },
        }
        result = _request(f"https://{host}/api/v2/statements", body)
        deadline = time.monotonic() + timeout_s
        while result.get("_status") == 202 and time.monotonic() < deadline:
            time.sleep(1)
            result = _request(f"https://{host}/api/v2/statements/{result['statementHandle']}", None)
        return result.get("data") or []

    return run


def runner_for(identity: str, env: dict[str, str] | None = None) -> Runner:
    env = env if env is not None else load_env()
    if identity == "builder":
        return snow_runner(env.get("BBC_CONNECTION", "pndvhar-pt70809"))
    if identity not in PERSONAS:
        raise ValueError(f"unknown identity {identity!r}; choose one of {IDENTITIES}")
    pat_var, role = PERSONAS[identity]
    return sqlapi_runner(env, pat_var, role)


def call_json(run: Runner, statement: str, params: list[Any]) -> Any:
    """Run a CALL that returns VARIANT and decode the single result."""
    rows = run(statement, params)
    if not rows or not rows[0]:
        raise RuntimeError("procedure returned no result")
    value = rows[0][0]
    return json.loads(value) if isinstance(value, str) else value
