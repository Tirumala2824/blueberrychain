"""The semantic model (snowflake/semantic/excursion_recovery.yaml): render its DDL and
hash its governed metric definitions.

* ``render_sql`` produces snowflake/modules/70_semantic_view.sql (helper views plus the
  CREATE SEMANTIC VIEW), via ``python -m blueberrychain.sqlgen``.
* ``definition_hashes`` gives each metric that implements a GOV.METRIC_REGISTRY entry a
  hash over everything its value depends on: its aggregate expression, the facts it
  reads (and their expressions), its non-additive dimensions and the base tables. The
  policy document carries these hashes, so a changed definition needs a new policy.
* ``python -m blueberrychain.semantic --update-policy`` writes them into the policy seed.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

import yaml
from bbc_toolkit import ledger

ROOT = Path(__file__).resolve().parents[4]
MODEL = ROOT / "snowflake" / "semantic" / "excursion_recovery.yaml"
POLICY = ROOT / "snowflake" / "seed" / "policy" / "v3.json"  # the current policy seed
REF = re.compile(r"\b([a-z_]+)\.([a-z_]+)\b")


def load_model(path: Path = MODEL) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _q(text: str) -> str:
    return "'" + " ".join(str(text).split()).replace("'", "''") + "'"


def _extras(item: dict[str, Any]) -> str:
    out = ""
    if item.get("synonyms"):
        out += " WITH SYNONYMS = (" + ", ".join(_q(s) for s in item["synonyms"]) + ")"
    if item.get("comment"):
        out += f" COMMENT = {_q(item['comment'])}"
    return out


def render_sql(model: dict[str, Any]) -> str:
    schema = model["name"].rsplit(".", 1)[0]
    lines = [
        "-- =============================================================================",
        "-- BlueberryChain OS - WP5: semantic view SEM.EXCURSION_RECOVERY (live layer)",
        "-- Generated from snowflake/semantic/excursion_recovery.yaml by",
        "-- `uv run python -m blueberrychain.sqlgen` - edit the YAML, not this file.",
        "-- Governed metrics carry a definition hash in the policy's metric_registry",
        "-- (blueberrychain.semantic.definition_hashes).",
        "-- =============================================================================",
        "USE ROLE BBC_OWNER;",
        f"USE SCHEMA {schema};",
        "",
    ]
    for view, body in model["views"].items():
        lines.append(f"CREATE OR REPLACE VIEW {schema}.{view} AS")
        lines.append(body.rstrip() + ";")
        lines.append("")
    tables = ",\n".join(
        f"    {t['alias']} AS {t['table']} PRIMARY KEY ({', '.join(t['primary_key'])}){_extras(t)}"
        for t in model["tables"]
    )
    rels = ",\n".join(
        f"    {r['name']} AS {r['from']} ({', '.join(r['columns'])}) REFERENCES {r['to']}"
        for r in model["relationships"]
    )
    facts = ",\n".join(f"    {f['name']} AS {f['expr']}{_extras(f)}" for f in model["facts"])
    dims = ",\n".join(f"    {d['name']} AS {d['expr']}{_extras(d)}" for d in model["dimensions"])

    def metric(m: dict[str, Any]) -> str:
        nab = ""
        if m.get("non_additive_by"):
            # The engine keeps the LAST rows in this sort order: ASC = latest snapshot
            # (DESC would silently return the earliest one).
            nab = " NON ADDITIVE BY (" + ", ".join(f"{d} ASC" for d in m["non_additive_by"]) + ")"
        return f"    {m['name']}{nab} AS {m['expr']}{_extras(m)}"

    metrics = ",\n".join(metric(m) for m in model["metrics"])
    lines += [
        f"CREATE OR REPLACE SEMANTIC VIEW {model['name']}",
        f"  TABLES (\n{tables}\n  )",
        f"  RELATIONSHIPS (\n{rels}\n  )",
        f"  FACTS (\n{facts}\n  )",
        f"  DIMENSIONS (\n{dims}\n  )",
        f"  METRICS (\n{metrics}\n  )",
        f"  COMMENT = {_q(model['comment'])}",
        f"  AI_SQL_GENERATION {_q(model['ai_sql_generation'])};",
        "",
    ]
    return "\n".join(lines)


def model_problems(model: dict[str, Any]) -> list[str]:
    """Structural checks: known aliases, many-to-one targets, metrics built only from facts."""
    aliases = {t["alias"] for t in model["tables"]}
    keys = {t["alias"]: t["primary_key"] for t in model["tables"]}
    facts = {f["name"] for f in model["facts"]}
    problems = []
    for r in model["relationships"]:
        if r["from"] not in aliases or r["to"] not in aliases:
            problems.append(f"relationship {r['name']}: unknown table")
        elif len(r["columns"]) != len(keys[r["to"]]):
            problems.append(f"relationship {r['name']}: must reference the whole key of {r['to']}")
    for kind in ("facts", "dimensions", "metrics"):
        for item in model[kind]:
            if item["name"].split(".")[0] not in aliases:
                problems.append(f"{kind} {item['name']}: unknown table")
    for m in model["metrics"]:
        refs = {f"{a}.{n}" for a, n in REF.findall(m["expr"])}
        if not refs or not refs <= facts:
            problems.append(
                f"metric {m['name']}: aggregate facts only (got {sorted(refs - facts)})"
            )
    registry = [m["registry"] for m in model["metrics"] if m.get("registry")]
    if len(registry) != len(set(registry)):
        problems.append("a registry metric is defined twice")
    for m in model["metrics"]:
        # The view's metric is named like its registry entry, so SQL tests can match them.
        if m.get("registry") and m["name"].split(".", 1)[1] != m["registry"].lower():
            problems.append(f"metric {m['name']}: name it after its registry entry")
    return problems


def definition_hashes(model: dict[str, Any]) -> dict[str, str]:
    facts = {f["name"]: f["expr"] for f in model["facts"]}
    tables = {t["alias"]: t["table"] for t in model["tables"]}
    out = {}
    for m in model["metrics"]:
        if not m.get("registry"):
            continue
        used = sorted({f"{a}.{n}" for a, n in REF.findall(m["expr"]) if f"{a}.{n}" in facts})
        out[m["registry"]] = ledger.canonical_hash(
            {
                "metric": m["name"],
                "expr": " ".join(m["expr"].split()),
                "facts": {f: " ".join(facts[f].split()) for f in used},
                "non_additive_by": m.get("non_additive_by", []),
                "tables": sorted({tables[f.split(".")[0]] for f in [m["name"], *used]}),
            }
        )
    return out


def policy_hash_problems(policy: dict[str, Any], model: dict[str, Any]) -> list[str]:
    """Registry entries whose definition_hash disagrees with the semantic model."""
    hashes = definition_hashes(model)
    problems = []
    for entry in policy["metric_registry"]:
        want = hashes.get(entry["name"])
        got = entry.get("definition_hash")
        if want and got != want:
            problems.append(f"{entry['name']}: policy has {got}, the semantic model gives {want}")
        if got and not want:
            problems.append(f"{entry['name']}: has a definition_hash but no semantic definition")
    missing = set(hashes) - {e["name"] for e in policy["metric_registry"]}
    problems += [
        f"{name}: defined in the semantic model but not in the registry" for name in sorted(missing)
    ]
    return problems


ENTRY = re.compile(
    r'^(\s*\{ "name": "([A-Z0-9_]+)".*?)(, "definition_hash": "[0-9a-f]{64}")?( \},?)$'
)


def update_policy(path: Path = POLICY, model: dict[str, Any] | None = None) -> int:
    """Write the hashes into the policy seed, editing only the registry lines that change
    (the seed keeps one registry entry per line, so the diff stays reviewable)."""
    hashes = definition_hashes(model or load_model())
    lines = path.read_text(encoding="utf-8").split("\n")
    changed = 0
    for i, line in enumerate(lines):
        m = ENTRY.match(line)
        if not m or m.group(2) not in hashes:
            continue
        new = f'{m.group(1)}, "definition_hash": "{hashes[m.group(2)]}"{m.group(4)}'
        if new != line:
            lines[i] = new
            changed += 1
    text = "\n".join(lines)
    doc = json.loads(text)  # still valid JSON, and every hash landed
    landed = {e["name"]: e.get("definition_hash") for e in doc["metric_registry"]}
    if any(landed.get(name) != h for name, h in hashes.items()):
        raise ValueError(f"{path}: registry entries must be one per line to update in place")
    path.write_text(text, encoding="utf-8", newline="\n")
    return changed


if __name__ == "__main__":
    if "--update-policy" in sys.argv:
        print(f"updated {update_policy()} definition hash(es) in {POLICY.relative_to(ROOT)}")
    else:
        print(json.dumps(definition_hashes(load_model()), indent=2))
