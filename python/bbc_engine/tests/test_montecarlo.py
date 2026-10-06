"""Seeded sampling primitives."""

import math

import pytest
from bbc_engine.montecarlo import Draws, mean, quantile, seed_for, tail_mean


def test_seed_is_a_stable_hash_of_its_parts():
    assert seed_for("CASE-1", "DEFAULT", 1, "0.1.0") == seed_for("CASE-1", "DEFAULT", 1, "0.1.0")
    assert seed_for("CASE-1", "DEFAULT", 1, "0.1.0") != seed_for("CASE-1", "DEFAULT", 2, "0.1.0")
    # Pinned: the seed must not depend on the platform or the interpreter's hash salt.
    assert seed_for("CASE-1", "DEFAULT", 1, "0.1.0") == int(
        __import__("hashlib").sha256(b"CASE-1|DEFAULT|1|0.1.0").hexdigest()[:12], 16
    )


def test_same_seed_same_stream():
    a, b = Draws(42), Draws(42)
    assert [a.normal(0, 1) for _ in range(5)] == [b.normal(0, 1) for _ in range(5)]
    assert Draws(1).normal(5, 0) == 5


def test_transit_lognormal_passes_through_p50_and_p90():
    d = Draws(7)
    xs = [d.transit_h(6.0, 7.5) for _ in range(20_000)]
    assert quantile(xs, 0.5) == pytest.approx(6.0, rel=0.02)
    assert quantile(xs, 0.9) == pytest.approx(7.5, rel=0.02)
    assert Draws(1).transit_h(4.0, 4.0) == 4.0
    assert Draws(1).transit_h(0.0, 1.0) == 0.0


def test_quantile_interpolates():
    assert quantile([1, 2, 3, 4], 0.5) == 2.5
    assert quantile([5], 0.9) == 5
    assert quantile([0, 10], 0.1) == pytest.approx(1.0)


def test_tail_mean_sees_rare_losses_a_percentile_misses():
    # 2% catastrophic outcomes: P10 is the good value, the 10% tail mean is not.
    xs = [100.0] * 98 + [0.0] * 2
    assert quantile(xs, 0.1) == 100.0
    assert tail_mean(xs, 0.1) == pytest.approx(80.0)
    assert tail_mean([3.0], 0.1) == 3.0
    assert math.isclose(mean([1, 2, 3]), 2.0)
    assert mean([]) == 0.0
