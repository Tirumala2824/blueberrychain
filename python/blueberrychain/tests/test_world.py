import copy

import pytest
from blueberrychain.sim import world as w


@pytest.fixture(scope="module")
def world():
    return w.load_world()


def test_default_world_is_valid_and_complete(world):
    batches = w.reference_batches(world)
    assert set(batches) == {e for e, _ in w.SECTIONS.values()}
    assert (
        len(batches["PARTY"]) == 9
    )  # own company, 2 growers, 2 carriers, 3 customers, 1 processor
    # scenario actors exist (docs/demo/scenarios.md)
    party_ids = {p["party_id"] for p in batches["PARTY"]}
    assert {
        "PARTY-SUMMIT",
        "PARTY-BAYLINE",
        "PARTY-SIERRA",
        "PARTY-EMERALD-RIDGE",
        "PARTY-VFP",
    } <= party_ids
    devices = {s["device_id"] for s in batches["SENSOR"]}
    assert {"P-A1", "P-B1", "RF-114", "P-001", "P-040", "RF-215"} <= devices


def test_records_are_plain_json(world):
    contract = next(c for c in world["contracts"] if c["contract_id"] == "CTR-SIERRA-2026")
    assert contract["effective_from"] == "2026-01-01"


def test_summit_spec_and_contract_match_the_scenario(world):
    batches = w.reference_batches(world)
    spec = next(
        s
        for s in batches["CUSTOMER_SPEC"]
        if s["customer_party_id"] == "PARTY-SUMMIT" and s["product_id"] == "BB-EMERALD-ORG-12x6"
    )
    assert spec["min_shelf_life_days_at_receipt"] == 10
    summit = next(c for c in batches["CONTRACT"] if c["contract_id"] == "CTR-SUMMIT-2026")
    assert summit["terms"]["price_usd_per_kg"] == 11.20


@pytest.mark.parametrize(
    ("mutate", "expected"),
    [
        (
            lambda wd: wd["lanes"][0].update(origin_site_id="SITE-NOWHERE"),
            "unknown site SITE-NOWHERE",
        ),
        (lambda wd: wd["lanes"][0].update(transit_h_p90=1.0), "p90 transit below p50"),
        (
            lambda wd: wd["contracts"][0].update(party_id="PARTY-SUMMIT"),
            "CARRIER_TRANSPORT with a CUSTOMER",
        ),
        (lambda wd: wd["parties"].append(dict(wd["parties"][0])), "duplicate party_id PARTY-BHM"),
        (lambda wd: wd["customer_specs"].clear(), "sales contract but no receipt specs"),
        (lambda wd: wd["products"][0].update(q10="three"), "products[0] /q10"),
        (
            lambda wd: wd["cost_rates"][1].update(scope_id="SITE-CVDC-TRACY"),
            "GLOBAL scope must not name",
        ),
    ],
)
def test_invalid_worlds_are_rejected_with_a_reason(world, mutate, expected):
    broken = copy.deepcopy(world)
    mutate(broken)
    with pytest.raises(w.WorldError) as info:
        w.reference_batches(broken)
    assert any(expected in p for p in info.value.problems), info.value.problems


def test_write_batches(tmp_path, world):
    paths = w.write_batches(w.reference_batches(world), tmp_path, world["meta"]["version"])
    assert {p.name for p in paths} >= {"party.json", "contract.json", "sensor.json"}
