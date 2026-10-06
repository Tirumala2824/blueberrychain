"""DECISION.OPEN_CASES: the detection rule's consequences, against an in-memory decision store."""

import json
from datetime import UTC, datetime, timedelta

import pytest
from bbc_toolkit import cases, ledger, snow
from fake_snowflake import FakeSnowflake

T0 = datetime(2026, 10, 6, 11, 0, tzinfo=UTC)


class FakeDecisionStore(FakeSnowflake):
    """FakeSnowflake plus the decision-store statements OPEN_CASES issues."""

    def __init__(self, detections=(), policy="1"):
        super().__init__()
        self.detections = [tuple(d) for d in detections]
        self.policy = policy
        self.counters = {"CASE": 1}
        self.cases: dict[str, dict] = {}
        self.case_lots: dict[tuple[str, str], dict] = {}
        self.consumed = 0
        self.lock_holder = None

    def _respond(self, q, p):
        if q == cases.ACTIVE_POLICY_SQL:
            return [(self.policy,)]
        if q == cases.LOCK_SQL:
            self.lock_holder = p[0]
            return []
        if q == cases.CONSUME_SQL:
            self.consumed += 1
            return []
        if q == cases.DETECT_SQL:
            return self.detections
        if q == cases.OPEN_CASES_SQL:
            out = []
            for case_id, c in self.cases.items():
                if c["state"] != "SEALED":
                    lots = sorted(lot for (cid, lot) in self.case_lots if cid == case_id)
                    out.append((case_id, c["episode_key"], c["state"], json.dumps(lots)))
            return out
        if q == cases.ALLOCATE_SQL:
            self.counters[p[1]] += p[0]
            return []
        if q == cases.ALLOCATED_SQL:
            return [(self.counters[p[0]],)]
        if q == cases.INSERT_CASE_SQL:
            keys = [
                "case_id",
                "severity",
                "episode_key",
                "shipment_id",
                "onset_at",
                "detected_at",
                "last_detected_at",
                "holder_party_id_at_onset",
                "holder_type_at_onset",
                "detection",
                "policy_version",
                "opened_by",
            ]
            row = dict(zip(keys, p, strict=True))
            self.cases[row["case_id"]] = {**row, "state": "OPEN", "needs_reassessment": False}
            return []
        if q == cases.INSERT_CASE_LOT_SQL:
            keys = [
                "case_id",
                "lot_id",
                "onset_at",
                "detected_at",
                "last_detected_at",
                "breach_min_at_detection",
                "max_pulp_c",
                "holder_party_id_at_onset",
            ]
            row = dict(zip(keys, p, strict=True))
            assert (row["case_id"], row["lot_id"]) not in self.case_lots, "duplicate case lot"
            self.case_lots[(row["case_id"], row["lot_id"])] = row
            return []
        if q == cases.JOIN_CASE_SQL:
            c = self.cases[p[1]]
            c["needs_reassessment"] = c["needs_reassessment"] or c["state"] != "OPEN"
            c["last_detected_at"] = max(c["last_detected_at"], p[0])
            return []
        if q == cases.EXTEND_CASE_SQL:
            c = self.cases[p[1]]
            c["last_detected_at"] = max(c["last_detected_at"], p[0])
            return []
        if q == cases.EXTEND_LOT_SQL:
            lot = self.case_lots[(p[1], p[2])]
            lot["last_detected_at"] = max(lot["last_detected_at"], p[0])
            return []
        return super()._respond(q, p)


def detection(
    lot="L-A",
    shipment="SHP-A",
    site=None,
    onset_min=0,
    detected_min=40,
    breach=35.0,
    max_pulp=6.5,
    holder="PARTY-SIERRA",
    party_type="CARRIER",
):
    return (
        lot,
        shipment,
        site,
        T0 + timedelta(minutes=onset_min),
        holder,
        party_type,
        T0 + timedelta(minutes=detected_min),
        breach,
        max_pulp,
        1.8,
        30,
        60,
        "1",
    )


def test_a_detected_lot_opens_a_case_with_its_ledger_entry():
    fake = FakeDecisionStore([detection()])
    result = snow.proc_open_cases(fake)
    assert result["status"] == "OK" and result["detected"] == 1
    [opened] = result["opened"]
    assert opened["case_id"] == "CASE-00000001" and opened["lots"] == ["L-A"]
    case = fake.cases["CASE-00000001"]
    assert case["episode_key"] == "SHP-A" and case["holder_type_at_onset"] == "CARRIER"
    assert case["severity"] == "MEDIUM"  # 6.5 C is 4.7 C over the threshold
    assert case["onset_at"] == "2026-10-06T11:00:00Z"
    [entry] = fake.ledger_entries()
    assert entry.entry_type == "CASE_OPENED" and entry.case_id == "CASE-00000001"
    assert entry.payload == json.loads(case["detection"])
    assert entry.payload["rule"] == {
        "detection_window_min": 60.0,
        "tolerance_min": 30.0,
        "threshold_c": 1.8,
        "policy_version": "1",
    }
    assert ledger.verify_chain(fake.ledger_entries()).ok
    assert fake.consumed == 1 and fake.lock_holder.startswith("OPEN_CASES DET-")


def test_lots_on_one_shipment_share_one_case():
    fake = FakeDecisionStore([detection("L-A"), detection("L-A2", onset_min=-10, max_pulp=9.0)])
    [opened] = snow.proc_open_cases(fake)["opened"]
    assert opened["lots"] == ["L-A2", "L-A"]  # earliest onset first
    case = fake.cases[opened["case_id"]]
    assert case["severity"] == "HIGH" and case["onset_at"] == "2026-10-06T10:50:00Z"
    assert len(fake.case_lots) == 2


def test_lots_off_a_shipment_open_one_case_each():
    fake = FakeDecisionStore(
        [
            detection("L-1", None, "SITE-CVDC-TRACY", holder="PARTY-BHM", party_type="OWN"),
            detection("L-2", None, "SITE-CVDC-TRACY", holder="PARTY-BHM", party_type="OWN"),
        ]
    )
    result = snow.proc_open_cases(fake)
    assert [o["episode_key"] for o in result["opened"]] == [
        "L-1@SITE-CVDC-TRACY",
        "L-2@SITE-CVDC-TRACY",
    ]
    assert [o["case_id"] for o in result["opened"]] == ["CASE-00000001", "CASE-00000002"]
    assert fake.cases["CASE-00000001"]["holder_type_at_onset"] == "DC"


def test_a_continuing_breach_extends_the_open_case():
    fake = FakeDecisionStore([detection(detected_min=40)])
    snow.proc_open_cases(fake)
    fake.detections = [detection(detected_min=45)]
    result = snow.proc_open_cases(fake)
    assert result["opened"] == [] and result["extended"] == ["CASE-00000001"]
    assert fake.cases["CASE-00000001"]["last_detected_at"] == "2026-10-06T11:45:00Z"
    assert fake.case_lots[("CASE-00000001", "L-A")]["last_detected_at"] == "2026-10-06T11:45:00Z"
    assert len(fake.ledger_entries()) == 1  # extending is not a new fact


def test_a_new_lot_on_the_shipment_joins_and_asks_for_reassessment():
    fake = FakeDecisionStore([detection("L-A")])
    snow.proc_open_cases(fake)
    fake.cases["CASE-00000001"]["state"] = "OPTIONS_SCORED"
    fake.detections = [detection("L-A2", detected_min=50)]
    result = snow.proc_open_cases(fake)
    assert result["joined"] == [{"case_id": "CASE-00000001", "lot_id": "L-A2", "ledger_seq": 2}]
    assert fake.cases["CASE-00000001"]["needs_reassessment"] is True
    assert [e.entry_type for e in fake.ledger_entries()] == ["CASE_OPENED", "CASE_LOT_ADDED"]


def test_a_sealed_case_does_not_absorb_a_new_excursion():
    fake = FakeDecisionStore([detection()])
    snow.proc_open_cases(fake)
    fake.cases["CASE-00000001"]["state"] = "SEALED"
    fake.detections = [detection(detected_min=600)]
    result = snow.proc_open_cases(fake)
    assert [o["case_id"] for o in result["opened"]] == ["CASE-00000002"]


def test_no_active_policy_means_no_detection_and_the_stream_is_kept():
    fake = FakeDecisionStore([detection()], policy=None)
    assert snow.proc_open_cases(fake)["status"] == "INVALID"
    assert fake.consumed == 0 and fake.cases == {}


def test_a_failure_rolls_everything_back():
    fake = FakeDecisionStore([detection()])
    fake.fail_on = "INSERT INTO BBC_OS.LEDGER.ENTRIES"
    with pytest.raises(RuntimeError):
        snow.proc_open_cases(fake)
    assert fake.statements[-1][0] == "ROLLBACK"


def test_quiet_runs_change_nothing():
    fake = FakeDecisionStore([])
    result = snow.proc_open_cases(fake)
    assert result == {**result, "detected": 0, "opened": [], "joined": [], "extended": []}
    assert fake.cases == {} and fake.ledger_entries() == []


def test_id_blocks_are_contiguous():
    fake = FakeDecisionStore()
    fake.counters["OPTION"] = 101
    assert snow.allocate_ids(fake, "OPTION", 3) == ["OPT-00000101", "OPT-00000102", "OPT-00000103"]
    assert snow.allocate_ids(fake, "OPTION", 1) == ["OPT-00000104"]
    assert snow.allocate_ids(fake, "OPTION", 0) == []


@pytest.mark.parametrize(("excess", "level"), [(0.5, "LOW"), (2.0, "MEDIUM"), (5.0, "HIGH")])
def test_severity_bands(excess, level):
    d = cases.Detection.from_row(detection(max_pulp=1.8 + excess))
    assert d.severity == level
