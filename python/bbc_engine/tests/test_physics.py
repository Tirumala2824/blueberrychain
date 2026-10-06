"""Physics reference implementation vs hand-computed cases."""

from datetime import UTC, datetime, timedelta

import pytest
from bbc_engine import physics as ph

EMERALD = ph.ShelfLifeModel(
    ref_shelf_life_days=21, tref_c=0.0, q10=3.0, threshold_c=1.8, unmonitored_assumed_temp_c=2.0
)
T0 = datetime(2026, 10, 6, 6, 0, tzinfo=UTC)


def series(start, temps, interval_s=300, holder=None):
    """One reading per interval, each closing its interval (first at start + interval)."""
    return [
        ph.Reading(start + timedelta(seconds=interval_s * (i + 1)), interval_s, t, holder)
        for i, t in enumerate(temps)
    ]


def test_rate_is_q10_per_ten_degrees():
    assert ph.rate(0.0, 0.0, 3.0) == 1.0
    assert ph.rate(10.0, 0.0, 3.0) == pytest.approx(3.0)
    assert ph.rate(20.0, 0.0, 3.0) == pytest.approx(9.0)
    assert ph.rate(-10.0, 0.0, 3.0) == pytest.approx(1 / 3)
    assert ph.rate(11.0, 1.0, 2.0) == pytest.approx(2.0)  # Tref shifts the curve


def test_one_hour_at_ten_degrees():
    t = ph.totals(series(T0, [10.0] * 12), EMERALD)
    assert t.monitored_min == pytest.approx(60)
    assert t.consumed_h == pytest.approx(3.0)  # one hour at 3x the reference rate
    assert t.excess_h == pytest.approx(3.0 - 3.0**0.18)
    assert t.breach_min == pytest.approx(60)
    assert t.degree_min_above == pytest.approx(8.2 * 60)
    assert t.max_temp_c == 10.0


def test_at_or_below_threshold_is_never_a_breach():
    e = ph.reading_effect(1.8, 300, EMERALD)
    assert e.breach_min == 0 and e.excess_h == 0 and e.degree_min_above == 0
    assert e.consumed_h == pytest.approx(3.0**0.18 / 12)


def test_remaining_shelf_life_fully_monitored():
    # 24 h at the reference temperature uses exactly one day of a 21-day life.
    state = ph.lot_state(EMERALD, T0, series(T0, [0.0] * 288))
    assert state.elapsed_h == pytest.approx(24)
    assert state.unmonitored_h == pytest.approx(0)
    assert state.remaining_shelf_life_days == pytest.approx(20.0)
    assert state.monitoring_coverage_pct == pytest.approx(100)
    assert state.temperature_compliance_pct == pytest.approx(100)


def test_gaps_are_charged_at_the_assumed_temperature():
    # Probe starts 2 h after harvest, then 22 h at 0 C: 2 unmonitored hours at 2.0 C.
    state = ph.lot_state(EMERALD, T0, series(T0 + timedelta(hours=2), [0.0] * 264))
    assert state.unmonitored_h == pytest.approx(2)
    expected_h = 504 - 22 - 2 * 3.0**0.2
    assert state.remaining_shelf_life_h == pytest.approx(expected_h)
    assert state.monitoring_coverage_pct == pytest.approx(22 / 24 * 100)


def test_compliance_is_minute_weighted():
    readings = series(T0, [0.5] * 9 + [5.0] * 3)  # 45 min ok, 15 min breach
    state = ph.lot_state(EMERALD, T0, readings)
    assert state.temperature_compliance_pct == pytest.approx(75)
    assert state.breach_min == pytest.approx(15)


def test_reading_order_does_not_matter():
    readings = series(T0, [0.5, 4.0, 9.0, 2.5, 0.7])
    a = ph.lot_state(EMERALD, T0, readings)
    b = ph.lot_state(EMERALD, T0, list(reversed(readings)))
    assert a == b


def test_custody_shares_sum_to_one_and_follow_excess():
    grower = series(T0, [1.0] * 12, holder="PARTY-EMERALD-RIDGE")  # never above threshold
    carrier = series(T0 + timedelta(hours=1), [8.0] * 12, holder="PARTY-SIERRA")
    dc = series(T0 + timedelta(hours=2), [4.0] * 12, holder="PARTY-BHM")
    exp = ph.custody_exposure(grower + carrier + dc, EMERALD)
    assert set(exp) == {"PARTY-BHM", "PARTY-EMERALD-RIDGE", "PARTY-SIERRA"}
    assert exp["PARTY-EMERALD-RIDGE"].excess_life_share == 0
    shares = [e.excess_life_share for e in exp.values()]
    assert sum(shares) == pytest.approx(1.0)
    r = 3.0**0.18
    assert exp["PARTY-SIERRA"].excess_life_share == pytest.approx(
        (3.0**0.8 - r) / ((3.0**0.8 - r) + (3.0**0.4 - r))
    )


def test_field_heat_inside_the_precool_window_is_nobodys_fault():
    # 1 h of field heat (inside a 4 h contractual pre-cool window), then a carrier breach.
    field = series(T0, [20.0] * 12, holder="PARTY-EMERALD-RIDGE")
    late = series(T0 + timedelta(hours=5), [6.0] * 12, holder="PARTY-SIERRA")
    exp = ph.custody_exposure(field + late, EMERALD, attributable_after=T0 + timedelta(hours=4))
    grower, carrier = exp["PARTY-EMERALD-RIDGE"], exp["PARTY-SIERRA"]
    assert grower.excess_h > carrier.excess_h  # the physics still sees the field heat ...
    assert grower.attributable_excess_h == 0  # ... but none of it is attributable
    assert (grower.excess_life_share, carrier.excess_life_share) == (0, 1)
    # Without a window, the same field heat would dominate the attribution.
    assert ph.custody_exposure(field + late, EMERALD)["PARTY-EMERALD-RIDGE"].excess_life_share > 0.5


def test_no_excess_means_no_share():
    exp = ph.custody_exposure(series(T0, [0.5] * 6, holder="PARTY-BHM"), EMERALD)
    assert exp["PARTY-BHM"].excess_life_share is None


def test_attribution_needs_a_holder():
    with pytest.raises(ValueError, match="holder"):
        ph.custody_exposure(series(T0, [0.5]), EMERALD)


def test_projection():
    # 240 h left, 15 more hours at 0.5 C.
    assert ph.project_shelf_life_days(240, 15, 0.5, 0.0, 3.0) == pytest.approx(
        (240 - 15 * 3.0**0.05) / 24
    )
    assert ph.project_shelf_life_days(240, 0, 30.0, 0.0, 3.0) == pytest.approx(10)


def test_model_from_reference_record():
    product = {
        "ref_shelf_life_days": 18,
        "tref_c": 0.0,
        "q10": 3.2,
        "threshold_c": 1.8,
        "unmonitored_assumed_temp_c": 2.0,
        "variety": "Duke",
    }
    m = ph.ShelfLifeModel.from_product(product)
    assert m.ref_life_h == 432 and m.rate(10) == pytest.approx(3.2)


def test_empty_series():
    state = ph.lot_state(EMERALD, T0, [])
    assert state.as_of is None and state.remaining_shelf_life_days == 21
    assert state.monitoring_coverage_pct is None and state.temperature_compliance_pct is None


def test_rejects_non_positive_interval():
    with pytest.raises(ValueError):
        ph.reading_effect(1.0, 0, EMERALD)
