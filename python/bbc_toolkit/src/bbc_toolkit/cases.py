"""DETECTION: which lots open, join or extend a Recovery Case (DECISION.OPEN_CASES).

The rule reads only versioned inputs: ``detection_window_min`` from the active policy and
each product's ``threshold_c`` / ``tolerance_min`` (REF.PRODUCTS).

* A lot is **in excursion** when, within the trailing detection window that ends at its
  last reading, its *counted* breach minutes exceed the product's tolerance.
* A reading **counts** when it lies outside the grower's contractual pre-cool window and
  either the lot's cold chain has started (it once reached its threshold) or someone other
  than its grower holds it. Field heat that pre-cooling never removed is the grower
  contract's matter (custody exposure attributes it); the case clock starts at the first
  handoff. Hard food-safety limits read the same way (bbc_engine, Day 3).
* **Onset** is the start of the current run of breaching readings (the first breach in the
  window when the run has already ended), so a late detection run still dates it right.

One open case per **episode**: the shipment the lot is physically on (LOADING, IN_TRANSIT,
AT_DOCK), or - off a shipment - the lot at its site. A detected lot that is already in an
open case extends it; one whose shipment already has an open case joins it (and asks for a
reassessment if the case has moved past OPEN); otherwise a new case opens with every
detected lot of that episode. A case stays open until it is SEALED.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

DECISION = "BBC_OS.DECISION"
OPEN_STATES_EXCLUDED = ("SEALED",)
ON_SHIPMENT = ("LOADING", "IN_TRANSIT", "AT_DOCK")
# party_type (REF.PARTIES) -> holder_type (contracts/schemas/common.json)
HOLDER_TYPES = {
    "OWN": "DC",
    "GROWER": "GROWER",
    "PACKHOUSE": "PACKHOUSE",
    "CARRIER": "CARRIER",
    "CUSTOMER": "CUSTOMER",
    "PROCESSOR": "PROCESSOR",
}
# Severity orders the inbox only; the value at risk comes from the engine.
SEVERITY_EXCESS_C = (("HIGH", 5.0), ("MEDIUM", 2.0))
ID_PREFIXES = {
    "CASE": "CASE",
    "PACK": "PACK",
    "OPTION": "OPT",
    "REC": "REC",
    "FINDING": "FND",
    "EVAL": "EVAL",
    "APPROVAL": "APR",
    "MUTATION": "MUT",
    "PLAN": "PLAN",
    "CLAIM": "CLM",
    "RUN": "RUN",
}

ACTIVE_POLICY_SQL = "SELECT BBC_OS.GOV.ACTIVE_POLICY_VERSION()"
LOCK_SQL = (
    f"UPDATE {DECISION}.GATEWAY_LOCK SET held_by = ?, held_at = CURRENT_TIMESTAMP() WHERE id = 1"
)

# Reading the stream inside the transaction advances its offset: these bucket changes are
# handled exactly once, and DETECTION_LOG keeps what each run looked at.
CONSUME_SQL = (
    f"INSERT INTO {DECISION}.DETECTION_LOG "
    "(run_id, lot_id, holder_party_id, bucket_start_utc, breach_min) "
    "SELECT ?, lot_id, holder_party_id, bucket_start_utc, breach_min "
    f"FROM {DECISION}.S_THERMAL_BUCKETS WHERE METADATA$ACTION = 'INSERT'"
)

DETECT_SQL = f"""
WITH touched AS (
  SELECT DISTINCT lot_id FROM {DECISION}.DETECTION_LOG WHERE run_id = ?
),
rule AS (
  SELECT MAX(policy_version) AS policy_version,
         MAX(IFF(param_key = 'detection_window_min', param_value::NUMBER, NULL)) AS window_min
  FROM BBC_OS.GOV.PARAMETERS
  WHERE policy_version = BBC_OS.GOV.ACTIVE_POLICY_VERSION()
),
lot_rule AS (
  SELECT s.lot_id, s.as_of AS last_reading_ts, s.cold_chain_started_at, l.grower_party_id,
         pr.threshold_c, pr.tolerance_min
  FROM BBC_OS.OPS.LOT_THERMAL_STATE s
  JOIN touched t ON t.lot_id = s.lot_id
  JOIN BBC_OS.OPS.LOTS l ON l.lot_id = s.lot_id
  JOIN BBC_OS.REF.PRODUCTS pr ON pr.product_id = s.product_id AND pr.is_current
),
counted AS (
  SELECT x.lot_id, x.last_reading_ts, x.threshold_c, x.tolerance_min,
         ta.reading_ts, ta.pulp_c, ta.breach_min, ta.holder_party_id, ta.custody_site_id
  FROM lot_rule x
  JOIN BBC_OS.OPS.TELEMETRY_ASSIGNED ta ON ta.lot_id = x.lot_id
  WHERE NOT ta.in_precool_window
    AND (ta.holder_party_id <> x.grower_party_id
         OR (x.cold_chain_started_at IS NOT NULL AND ta.reading_ts >= x.cold_chain_started_at))
),
windowed AS (
  SELECT c.lot_id, ANY_VALUE(c.last_reading_ts) AS detected_at,
         ANY_VALUE(c.threshold_c) AS threshold_c, ANY_VALUE(c.tolerance_min) AS tolerance_min,
         ANY_VALUE(r.window_min) AS window_min, ANY_VALUE(r.policy_version) AS policy_version,
         SUM(c.breach_min) AS breach_min_in_window, MAX(c.pulp_c) AS max_pulp_c,
         MIN(IFF(c.breach_min > 0, c.reading_ts, NULL)) AS first_breach_in_window
  FROM counted c CROSS JOIN rule r
  WHERE c.reading_ts > DATEADD('minute', -r.window_min, c.last_reading_ts)
  GROUP BY c.lot_id
  HAVING SUM(c.breach_min) > ANY_VALUE(c.tolerance_min)
),
recovered AS (
  SELECT lot_id, MAX(reading_ts) AS last_ok_ts FROM counted WHERE breach_min = 0 GROUP BY lot_id
),
run_start AS (
  SELECT c.lot_id, c.reading_ts AS onset_at, c.holder_party_id, c.custody_site_id
  FROM counted c LEFT JOIN recovered k ON k.lot_id = c.lot_id
  WHERE c.breach_min > 0 AND c.reading_ts > COALESCE(k.last_ok_ts, '1900-01-01'::TIMESTAMP_TZ)
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.lot_id ORDER BY c.reading_ts) = 1
),
window_start AS (
  SELECT c.lot_id, c.holder_party_id, c.custody_site_id
  FROM counted c JOIN windowed w ON w.lot_id = c.lot_id AND c.reading_ts = w.first_breach_in_window
  QUALIFY ROW_NUMBER() OVER (PARTITION BY c.lot_id ORDER BY c.reading_ts) = 1
),
on_shipment AS (
  SELECT sl.lot_id, s.shipment_id
  FROM BBC_OS.OPS.SHIPMENT_LOTS sl
  JOIN windowed w ON w.lot_id = sl.lot_id
  JOIN BBC_OS.OPS.SHIPMENTS s ON s.shipment_id = sl.shipment_id
  WHERE s.status IN ('LOADING', 'IN_TRANSIT', 'AT_DOCK')
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY sl.lot_id ORDER BY s.planned_departure_at DESC NULLS LAST, s.shipment_id DESC
  ) = 1
)
SELECT w.lot_id, sh.shipment_id,
       COALESCE(rs.custody_site_id, ws.custody_site_id)        AS site_id,
       COALESCE(rs.onset_at, w.first_breach_in_window)          AS onset_at,
       COALESCE(rs.holder_party_id, ws.holder_party_id)         AS holder_party_id,
       p.party_type                                             AS holder_party_type,
       w.detected_at, w.breach_min_in_window, w.max_pulp_c, w.threshold_c, w.tolerance_min,
       w.window_min, w.policy_version
FROM windowed w
LEFT JOIN run_start rs ON rs.lot_id = w.lot_id
LEFT JOIN window_start ws ON ws.lot_id = w.lot_id
LEFT JOIN on_shipment sh ON sh.lot_id = w.lot_id
LEFT JOIN BBC_OS.REF.PARTIES p
  ON p.party_id = COALESCE(rs.holder_party_id, ws.holder_party_id) AND p.is_current
ORDER BY w.lot_id
""".strip()

OPEN_CASES_SQL = (
    "SELECT c.case_id, c.episode_key, c.state, "
    "ARRAY_AGG(cl.lot_id) WITHIN GROUP (ORDER BY cl.lot_id) AS lot_ids "
    f"FROM {DECISION}.CASES c JOIN {DECISION}.CASE_LOTS cl ON cl.case_id = c.case_id "
    "WHERE c.state <> 'SEALED' GROUP BY c.case_id, c.episode_key, c.state"
)
INSERT_CASE_SQL = (
    f"INSERT INTO {DECISION}.CASES (case_id, decision_point, state, severity, episode_key, "
    "shipment_id, onset_at, detected_at, last_detected_at, opened_at, holder_party_id_at_onset, "
    "holder_type_at_onset, detection, policy_version, opened_by, updated_at) "
    "SELECT ?, 'D1', 'OPEN', ?, ?, ?, TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), "
    "CURRENT_TIMESTAMP(), ?, ?, PARSE_JSON(?), ?, ?, CURRENT_TIMESTAMP()"
)
INSERT_CASE_LOT_SQL = (
    f"INSERT INTO {DECISION}.CASE_LOTS (case_id, lot_id, added_at, onset_at, detected_at, "
    "last_detected_at, breach_min_at_detection, max_pulp_c, holder_party_id_at_onset) "
    "SELECT ?, ?, CURRENT_TIMESTAMP(), TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), TO_TIMESTAMP_TZ(?), "
    "?, ?, ?"
)
JOIN_CASE_SQL = (
    f"UPDATE {DECISION}.CASES SET needs_reassessment = needs_reassessment OR state <> 'OPEN', "
    "last_detected_at = GREATEST(last_detected_at, TO_TIMESTAMP_TZ(?)), "
    "updated_at = CURRENT_TIMESTAMP() WHERE case_id = ?"
)
EXTEND_CASE_SQL = (
    f"UPDATE {DECISION}.CASES SET last_detected_at = "
    "GREATEST(last_detected_at, TO_TIMESTAMP_TZ(?)), updated_at = CURRENT_TIMESTAMP() "
    "WHERE case_id = ?"
)
EXTEND_LOT_SQL = (
    f"UPDATE {DECISION}.CASE_LOTS SET last_detected_at = GREATEST(last_detected_at, "
    "TO_TIMESTAMP_TZ(?)) WHERE case_id = ? AND lot_id = ?"
)
ALLOCATE_SQL = f"UPDATE {DECISION}.ID_COUNTERS SET next_value = next_value + ? WHERE kind = ?"
ALLOCATED_SQL = f"SELECT next_value FROM {DECISION}.ID_COUNTERS WHERE kind = ?"


def iso(moment: datetime | str) -> str:
    if isinstance(moment, str):
        return moment
    return moment.isoformat().replace("+00:00", "Z")


def format_id(kind: str, number: int) -> str:
    return f"{ID_PREFIXES[kind]}-{number:08d}"


@dataclass(frozen=True)
class Detection:
    lot_id: str
    shipment_id: str | None
    site_id: str | None
    onset_at: datetime | str
    holder_party_id: str | None
    holder_party_type: str | None
    detected_at: datetime | str
    breach_min_in_window: float
    max_pulp_c: float
    threshold_c: float
    tolerance_min: float
    window_min: float
    policy_version: str

    @classmethod
    def from_row(cls, row: Iterable[Any]) -> Detection:
        r = list(row)
        return cls(
            str(r[0]),
            r[1],
            r[2],
            r[3],
            r[4],
            r[5],
            r[6],
            float(r[7]),
            float(r[8]),
            float(r[9]),
            float(r[10]),
            float(r[11]),
            str(r[12]),
        )

    @property
    def episode_key(self) -> str:
        return self.shipment_id or f"{self.lot_id}@{self.site_id or 'UNKNOWN'}"

    @property
    def holder_type(self) -> str | None:
        return HOLDER_TYPES.get(self.holder_party_type or "")

    @property
    def severity(self) -> str:
        excess = round(self.max_pulp_c - self.threshold_c, 6)  # 1.8 + 2.0 - 1.8 < 2.0 in floats
        return next((level for level, above in SEVERITY_EXCESS_C if excess >= above), "LOW")

    def lot_payload(self) -> dict[str, Any]:
        return {
            "lot_id": self.lot_id,
            "onset_at": iso(self.onset_at),
            "detected_at": iso(self.detected_at),
            "breach_min_in_window": self.breach_min_in_window,
            "max_pulp_c": self.max_pulp_c,
            "holder_party_id_at_onset": self.holder_party_id,
        }


@dataclass(frozen=True)
class OpenCase:
    case_id: str
    episode_key: str
    state: str
    lot_ids: frozenset[str]


@dataclass
class Plan:
    opens: list[tuple[str, list[Detection]]] = field(default_factory=list)  # episode -> its lots
    joins: list[tuple[str, Detection]] = field(default_factory=list)  # case_id, lot
    extends: list[tuple[str, Detection]] = field(default_factory=list)


def plan(detections: Iterable[Detection], open_cases: Iterable[OpenCase]) -> Plan:
    cases = list(open_cases)
    by_lot = {lot: c for c in cases for lot in c.lot_ids}
    by_episode = {c.episode_key: c for c in cases}
    out = Plan()
    opening: dict[str, list[Detection]] = {}
    for d in sorted(detections, key=lambda d: (d.episode_key, iso(d.onset_at), d.lot_id)):
        if d.lot_id in by_lot:
            out.extends.append((by_lot[d.lot_id].case_id, d))
        elif d.episode_key in by_episode:
            out.joins.append((by_episode[d.episode_key].case_id, d))
        else:
            opening.setdefault(d.episode_key, []).append(d)
    out.opens = sorted(opening.items())
    return out


def case_payload(
    case_id: str, episode_key: str, lots: list[Detection], run_id: str
) -> dict[str, Any]:
    """The CASE_OPENED ledger payload (and the case's ``detection`` column)."""
    first = min(lots, key=lambda d: (iso(d.onset_at), d.lot_id))
    worst = max(lots, key=lambda d: d.max_pulp_c - d.threshold_c)
    return {
        "case_id": case_id,
        "decision_point": "D1",
        "episode_key": episode_key,
        "shipment_id": first.shipment_id,
        "severity": worst.severity,
        "onset_at": iso(first.onset_at),
        "holder_party_id_at_onset": first.holder_party_id,
        "holder_type_at_onset": first.holder_type,
        "lots": [d.lot_payload() for d in lots],
        "rule": {
            "detection_window_min": first.window_min,
            "tolerance_min": first.tolerance_min,
            "threshold_c": first.threshold_c,
            "policy_version": first.policy_version,
        },
        "run_id": run_id,
    }
