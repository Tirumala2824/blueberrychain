"""Seeded sampling. Python's ``random`` (not numpy): its streams are reproducible for a
given seed across platforms and versions, so a replay in Snowflake gives identical numbers.
"""

from __future__ import annotations

import hashlib
import math
import random
from collections.abc import Sequence

Z90 = 1.2815515655446004  # standard normal 90th percentile


def seed_for(*parts: object) -> int:
    """seed = hash(case_id, option, pack revision, engine version) - plan Phase 11."""
    digest = hashlib.sha256("|".join(str(p) for p in parts).encode()).hexdigest()
    return int(digest[:12], 16)


class Draws:
    def __init__(self, seed: int):
        self.seed = seed
        self._r = random.Random(seed)

    def normal(self, mean: float, sd: float) -> float:
        return self._r.gauss(mean, sd) if sd > 0 else mean

    def uniform(self, low: float, high: float) -> float:
        return self._r.uniform(low, high)

    def chance(self, p: float) -> bool:
        return self._r.random() < p

    def transit_h(self, p50: float, p90: float) -> float:
        """Lognormal through the lane's p50 and p90."""
        if p50 <= 0:
            return 0.0
        if p90 <= p50:
            return p50
        sigma = (math.log(p90) - math.log(p50)) / Z90
        return math.exp(self._r.gauss(math.log(p50), sigma))


def quantile(values: Sequence[float], q: float) -> float:
    """Linear-interpolated quantile of a non-empty sample."""
    xs = sorted(values)
    if len(xs) == 1:
        return xs[0]
    pos = q * (len(xs) - 1)
    lo = math.floor(pos)
    hi = min(lo + 1, len(xs) - 1)
    return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)


def tail_mean(values: Sequence[float], q: float = 0.1) -> float:
    """Mean of the worst ``q`` share of outcomes (expected shortfall). Unlike a percentile it
    sees rare large losses: with 2% rejections, P10 can sit above the mean."""
    xs = sorted(values)
    k = max(1, math.ceil(q * len(xs)))
    return sum(xs[:k]) / k


def mean(values: Sequence[float]) -> float:
    return sum(values) / len(values) if values else 0.0
