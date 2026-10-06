"""Shelf life along a route: pulp temperature follows each leg's surroundings with a
first-order lag, and shelf life is consumed at ``physics.rate`` of the pulp temperature.

This is the estimator's model of the future (it never sees the simulator's truth): it
uses only the product's parameters and the pack's last pulp temperature.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from bbc_engine.physics import rate

MAX_STEP_H = 0.5


@dataclass(frozen=True)
class Leg:
    hours: float
    target_c: float
    tau_h: float


def approach(value: float, target: float, tau_h: float, hours: float) -> float:
    if tau_h <= 0:
        return target
    return target + (value - target) * math.exp(-hours / tau_h)


def run_legs(start_c: float, legs: list[Leg], tref_c: float, q10: float) -> tuple[float, float]:
    """(reference hours of shelf life consumed, pulp temperature at the end)."""
    temp = start_c
    consumed = 0.0
    for leg in legs:
        if leg.hours <= 0:
            continue
        steps = max(1, math.ceil(leg.hours / MAX_STEP_H))
        dt = leg.hours / steps
        for _ in range(steps):
            nxt = approach(temp, leg.target_c, leg.tau_h, dt)
            consumed += rate((temp + nxt) / 2, tref_c, q10) * dt
            temp = nxt
    return consumed, temp


def at_setpoint_days(
    remaining_days: float, hours: float, setpoint_c: float, tref_c: float, q10: float
) -> float:
    """Remaining days after ``hours`` held at a steady temperature (the projection UDF's form)."""
    return remaining_days - hours * rate(setpoint_c, tref_c, q10) / 24.0
