"""A tiny in-memory stand-in for the Snowpark session, enough to exercise bbc_toolkit.snow.

It understands exactly the statements the handlers issue (ledger HEAD lock pattern,
versioned REF inserts/updates, GOV policy rows) and records everything else.
"""

from __future__ import annotations

import json
import re
from types import SimpleNamespace
from typing import Any

from bbc_toolkit import ledger, reference


class FakeSnowflake:
    def __init__(self, user: str = "DURGAPRASAD17"):
        self.user = user
        self.statements: list[tuple[str, list[Any]]] = []
        self.head = {"last_seq": 0, "last_hash": ledger.GENESIS_HASH}
        self.entries: list[dict[str, Any]] = []
        self.ref: dict[str, list[dict[str, Any]]] = {}
        self.policies: dict[str, dict[str, Any]] = {}
        self.gov_rows: dict[str, int] = {}
        self.raw: dict[str, dict[str, dict[str, Any]]] = {"TELEMETRY": {}, "BUSINESS_EVENTS": {}}
        self.ingest_errors: list[dict[str, Any]] = []
        self.cursors: dict[tuple[str, str], str | None] = {}
        self.fail_on: str | None = None  # substring that makes a statement raise

    # --- Snowpark surface ---------------------------------------------------------
    def sql(self, query: str, params: list[Any] | None = None):
        params = list(params or [])
        self.statements.append((query, params))
        if self.fail_on and self.fail_on in query:
            raise RuntimeError(f"injected failure on: {self.fail_on}")
        rows = self._respond(query, params)
        return SimpleNamespace(collect=lambda: rows)

    # --- helpers for tests --------------------------------------------------------
    def ledger_entries(self) -> list[ledger.LedgerEntry]:
        return [
            ledger.LedgerEntry(
                seq=e["seq"],
                ts=e["ts"],
                entry_type=e["entry_type"],
                case_id=e["case_id"],
                actor=e["actor"],
                record_ref=e["record_ref"],
                payload=json.loads(e["payload"]),
                payload_hash=e["payload_hash"],
                prev_hash=e["prev_hash"],
                entry_hash=e["entry_hash"],
            )
            for e in self.entries
        ]

    def executed(self, prefix: str) -> list[tuple[str, list[Any]]]:
        return [s for s in self.statements if s[0].lstrip().upper().startswith(prefix.upper())]

    # --- statement handling -------------------------------------------------------
    def _respond(self, q: str, p: list[Any]) -> list[tuple]:
        if q in ("BEGIN", "COMMIT", "ROLLBACK"):
            return []
        if q == "SELECT CURRENT_USER()":
            return [(self.user,)]
        if "BBC_OS.RAW." in q:
            return self._respond_raw(q, p)
        if "LEDGER.HEAD SET last_seq = last_seq + 1" in q:
            self.head["last_seq"] += 1
            return []
        if q.startswith("SELECT last_seq, last_hash FROM BBC_OS.LEDGER.HEAD"):
            return [(self.head["last_seq"], self.head["last_hash"])]
        if "LEDGER.HEAD SET last_hash = ?" in q:
            self.head["last_hash"] = p[0]
            return []
        if q.startswith("INSERT INTO BBC_OS.LEDGER.ENTRIES"):
            keys = [
                "seq",
                "ts",
                "ts_tz",
                "entry_type",
                "case_id",
                "actor",
                "record_ref",
                "payload",
                "payload_hash",
                "prev_hash",
                "entry_hash",
            ]
            self.entries.append(dict(zip(keys, p, strict=True)))
            return []
        if q.startswith("INSERT INTO BBC_OS.GOV.POLICY_VERSIONS"):
            version, document, content_hash, _description = p
            self.policies[version] = {
                "status": "DRAFT",
                "document": document,
                "content_hash": content_hash,
                "drafted_by": self.user,
            }
            return []
        if q.startswith("SELECT status FROM BBC_OS.GOV.POLICY_VERSIONS"):
            row = self.policies.get(p[0])
            return [(row["status"],)] if row else []
        if q.startswith(
            "SELECT status, document, content_hash, drafted_by FROM BBC_OS.GOV.POLICY_VERSIONS"
        ):
            row = self.policies.get(p[0])
            return (
                [(row["status"], row["document"], row["content_hash"], row["drafted_by"])]
                if row
                else []
            )
        if q.startswith(
            "SELECT policy_version FROM BBC_OS.GOV.POLICY_VERSIONS WHERE status = 'ACTIVE'"
        ):
            return [(v,) for v, r in self.policies.items() if r["status"] == "ACTIVE"]
        if q.startswith("UPDATE BBC_OS.GOV.POLICY_VERSIONS SET status = 'RETIRED'"):
            for row in self.policies.values():
                if row["status"] == "ACTIVE":
                    row["status"] = "RETIRED"
            return []
        if q.startswith("UPDATE BBC_OS.GOV.POLICY_VERSIONS SET status = 'ACTIVE'"):
            _reason, version = p
            if self.policies.get(version, {}).get("status") == "DRAFT":
                self.policies[version].update(status="ACTIVE", activated_by=self.user)
            return []
        if q.startswith("DELETE FROM BBC_OS.GOV.POLICY_VERSIONS"):
            self.policies.pop(p[0], None)
            return []
        m = re.match(r"(INSERT INTO|DELETE FROM) BBC_OS\.GOV\.(\w+)", q)
        if m:
            table = m.group(2)
            if m.group(1) == "INSERT INTO":
                self.gov_rows[table] = self.gov_rows.get(table, 0) + 1
            else:
                self.gov_rows[table] = 0
            return []
        return self._respond_ref(q, p)

    def _respond_raw(self, q: str, p: list[Any]) -> list[tuple]:
        m = re.match(r"MERGE INTO BBC_OS\.RAW\.(TELEMETRY|BUSINESS_EVENTS) ", q)
        if m:
            table = self.raw[m.group(1)]
            rows, connector_id = json.loads(p[0]), p[1]
            inserted = 0
            for row in rows:
                if row["idempotency_key"] not in table:
                    table[row["idempotency_key"]] = {**row, "connector_id": connector_id}
                    inserted += 1
            return [(inserted,)]
        if q.startswith("INSERT INTO BBC_OS.RAW.INGEST_ERRORS"):
            connector_id, target, dead = p
            for d in json.loads(dead):
                self.ingest_errors.append({"connector_id": connector_id, "target": target, **d})
            return []
        if q.startswith("MERGE INTO BBC_OS.RAW.CONNECTOR_STATE"):
            connector_id, stream, cursor = p
            self.cursors[(connector_id, stream)] = cursor
            return []
        if q.startswith("SELECT stream, cursor_value, updated_at FROM BBC_OS.RAW.CONNECTOR_STATE"):
            return [
                (stream, cursor, "2026-10-06T08:00:00+00:00")
                for (connector, stream), cursor in sorted(self.cursors.items())
                if connector == p[0]
            ]
        raise AssertionError(f"unhandled statement: {q}")

    def _entity_for(self, q: str) -> str:
        for name, ent in reference.ENTITIES.items():
            if ent.table in q:
                return name
        raise AssertionError(f"unhandled statement: {q}")

    def _respond_ref(self, q: str, p: list[Any]) -> list[tuple]:
        name = self._entity_for(q)
        ent = reference.ENTITIES[name]
        rows = self.ref.setdefault(ent.table, [])
        if q.startswith("SELECT"):
            return [
                (*(r[k] for k in ent.key), r["version"], r["record_hash"])
                for r in rows
                if r["is_current"]
            ]
        if q.startswith("UPDATE"):
            key = tuple(p[: len(ent.key)])
            for r in rows:
                if r["is_current"] and tuple(str(r[k]) for k in ent.key) == key:
                    r["is_current"] = False
            return []
        if q.startswith("INSERT"):
            cols = reference.columns(name)
            values = dict(zip(cols, p[: len(cols)], strict=True))
            version, reason, record_hash, batch_id = p[len(cols) :]
            rows.append(
                {
                    **values,
                    "version": version,
                    "record_hash": record_hash,
                    "batch_id": batch_id,
                    "is_current": True,
                    "change_reason": reason,
                }
            )
            return []
        raise AssertionError(f"unhandled statement: {q}")
