"""Spike S8/S9: call the Cortex Agent REST API with BBC_AGENT_SVC's PAT and stream SSE.

Checks:
  S8a  REST `:run` authenticates with a role-restricted programmatic access token
  S8b  the response streams as server-sent events
  S9a  the generic tool receives P_PAYLOAD as a JSON *string* and decodes it
  S9b  the tool executes as the calling service user (default role = BBC_AGENT_RUNTIME)
  S9c  a tool whose procedure the runtime role cannot USE is refused

Usage (from the repo root, after wp1_spikes.sql created SANDBOX.SPIKE_AGENT):
  uv run python snowflake/spikes/s8_agent_rest.py
Raw events are written to .artifacts/s8_<case>.jsonl for the ADR evidence.
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

from _env import REPO_ROOT, load_env, require

CASES = {
    "echo": 'Run id RUN-S8-1. Echo {"case_id": "C-1", "lots": ["L-1", "L-2"]}',
    "restricted": "Run the restricted tool and report exactly what happened.",
}


def run_agent(env: dict[str, str], prompt: str) -> list[tuple[str, object]]:
    host = env.get("SNOWFLAKE_HOST") or f"{env['SNOWFLAKE_ACCOUNT']}.snowflakecomputing.com"
    url = f"https://{host}/api/v2/databases/BBC_OS/schemas/SANDBOX/agents/SPIKE_AGENT:run"
    body = {"messages": [{"role": "user", "content": [{"type": "text", "text": prompt}]}]}
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        method="POST",
        headers={
            "Authorization": f"Bearer {env['BBC_AGENT_PAT']}",
            "X-Snowflake-Authorization-Token-Type": "PROGRAMMATIC_ACCESS_TOKEN",
            "Content-Type": "application/json",
            "Accept": "text/event-stream",
        },
    )
    events: list[tuple[str, object]] = []
    event_name = "message"
    with urllib.request.urlopen(request, timeout=120) as response:
        content_type = response.headers.get("Content-Type", "")
        events.append(("_content_type", content_type))
        for raw in response:
            line = raw.decode("utf-8").rstrip("\r\n")
            if line.startswith("event:"):
                event_name = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = line[len("data:") :].strip()
                try:
                    events.append((event_name, json.loads(data)))
                except json.JSONDecodeError:
                    events.append((event_name, data))
    return events


def find_keys(obj: object, wanted: set[str], found: list[dict]) -> list[dict]:
    """Collect every dict that contains one of the wanted keys (tool_use / tool_result)."""
    if isinstance(obj, dict):
        if wanted & obj.keys():
            found.append(obj)
        for value in obj.values():
            find_keys(value, wanted, found)
    elif isinstance(obj, list):
        for value in obj:
            find_keys(value, wanted, found)
    return found


def main() -> int:
    env = load_env()
    require(env, "BBC_AGENT_PAT", "SNOWFLAKE_ACCOUNT")
    artifacts = REPO_ROOT / ".artifacts"
    artifacts.mkdir(exist_ok=True)

    for case, prompt in CASES.items():
        print(f"\n=== {case} ===")
        try:
            events = run_agent(env, prompt)
        except urllib.error.HTTPError as exc:
            print(f"HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')[:600]}")
            continue
        out = Path(artifacts / f"s8_{case}.jsonl")
        out.write_text("\n".join(json.dumps({"event": n, "data": d}) for n, d in events), "utf-8")

        names: dict[str, int] = {}
        for name, _ in events:
            names[name] = names.get(name, 0) + 1
        print("content-type:", events[0][1] if events else "?")
        print("event types:", json.dumps(names))
        tool_objects = find_keys([d for _, d in events], {"tool_use", "tool_result"}, [])
        for obj in tool_objects[:6]:
            print("tool block:", json.dumps(obj)[:500])
        print(f"raw events -> {out.relative_to(REPO_ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
