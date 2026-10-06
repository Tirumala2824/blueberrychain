"""Ground-truth thermal model of lots and reefer trailers (ADR-0006).

This is the *world*, not the estimator. Each lot draws its own true shelf-life
parameters around the product's (``bbc_engine`` only knows the product's), and its
pulp temperature follows its surroundings with a first-order lag. Probes then measure
it imperfectly (noise, misplacement, dropouts) - which is what makes prediction error
real and outcome tracking meaningful.

Reefer trailers are a single air node: a working unit holds return air near setpoint;
a failed compressor lets the trailer drift to ambient; open doors reach ambient within
minutes; a stuck defrost heats the air. Pulp in a loaded trailer follows the air
slowly (tau ~8 h), which is why reefers *maintain* temperature but cannot pull warm
fruit down quickly.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Any

from bbc_engine.physics import rate


def approach(value: float, target: float, tau_h: float, dt_s: float) -> float:
    """Exact first-order step toward ``target`` (stable for any step size)."""
    if tau_h <= 0:
        return target
    return target + (value - target) * math.exp(-dt_s / (tau_h * 3600.0))


@dataclass
class LotTruth:
    """A lot's true state; never sent anywhere except the truth file."""

    lot_id: str
    product_id: str
    ref_shelf_life_days: float
    q10: float
    tref_c: float
    pulp_c: float
    consumed_h: float = 0.0
    max_pulp_c: float = -99.0

    def step(self, target_c: float, tau_h: float, dt_s: float) -> None:
        before = self.pulp_c
        self.pulp_c = approach(before, target_c, tau_h, dt_s)
        mid = (before + self.pulp_c) / 2
        self.consumed_h += rate(mid, self.tref_c, self.q10) * dt_s / 3600.0
        self.max_pulp_c = max(self.max_pulp_c, self.pulp_c)

    @property
    def remaining_shelf_life_days(self) -> float:
        return (self.ref_shelf_life_days * 24.0 - self.consumed_h) / 24.0

    def summary(self) -> dict[str, Any]:
        return {
            "lot_id": self.lot_id,
            "product_id": self.product_id,
            "true_ref_shelf_life_days": round(self.ref_shelf_life_days, 3),
            "true_q10": round(self.q10, 3),
            "pulp_c": round(self.pulp_c, 2),
            "max_pulp_c": round(self.max_pulp_c, 2),
            "consumed_ref_h": round(self.consumed_h, 2),
            "remaining_shelf_life_days": round(self.remaining_shelf_life_days, 3),
        }


def draw_truth(
    product: dict[str, Any],
    lot_id: str,
    initial_pulp_c: float,
    q10_sigma: float,
    rng: random.Random,
) -> LotTruth:
    return LotTruth(
        lot_id=lot_id,
        product_id=product["product_id"],
        ref_shelf_life_days=max(
            rng.gauss(product["ref_shelf_life_days"], product["prior_sigma_days"]), 1.0
        ),
        q10=max(rng.gauss(product["q10"], q10_sigma), 1.1),
        tref_c=product["tref_c"],
        pulp_c=initial_pulp_c,
    )


@dataclass
class ReeferState:
    """One trailer's air node and what its unit reports."""

    truck_id: str
    device_id: str
    air_c: float
    setpoint_c: float
    mode: str = "CONTINUOUS"
    door_open: bool = False
    door_open_s: float = 0.0
    defrost_stuck_s: float = 0.0
    alarms: tuple[str, ...] = ()
    supply_c: float = 0.0
    return_c: float = 0.0

    def step(
        self,
        cfg: dict[str, Any],
        dt_s: float,
        *,
        ambient_c: float,
        pulp_c: float,
        compressor_ok: bool,
        defrost_stuck: bool,
        door_open: bool,
        defrost_cycle: bool,
        rng: random.Random,
    ) -> None:
        k, leak = cfg["return_air_k"], cfg["return_air_leak_c"]
        self.door_open = door_open
        self.door_open_s = self.door_open_s + dt_s if door_open else 0.0
        self.defrost_stuck_s = self.defrost_stuck_s + dt_s if defrost_stuck else 0.0
        alarms = []
        if door_open:
            self.air_c = approach(self.air_c, ambient_c, cfg["tau_air_door_min"] / 60, dt_s)
            self.mode = "CONTINUOUS"
            self.supply_c = self.air_c
        elif defrost_stuck:
            self.air_c = approach(
                self.air_c, cfg["stuck_defrost_air_c"], cfg["tau_air_defrost_h"], dt_s
            )
            self.mode = "DEFROST"
            self.supply_c = self.air_c + cfg["defrost_supply_rise_c"] / 2
        elif not compressor_ok:
            self.air_c = approach(self.air_c, ambient_c, cfg["tau_air_fail_h"], dt_s)
            self.mode = "CONTINUOUS"
            self.supply_c = self.air_c
            alarms.append("COMPRESSOR_FAULT")
        elif defrost_cycle:
            self.mode = "DEFROST"
            self.supply_c = self.air_c + cfg["defrost_supply_rise_c"]
        else:
            self.mode = "CONTINUOUS"
            self.air_c = approach(
                self.air_c, self.setpoint_c + leak / 2, cfg["tau_air_recover_h"], dt_s
            )
            self.supply_c = self.setpoint_c + rng.gauss(0, 0.1)
        if door_open and self.door_open_s >= 600:
            alarms.append("DOOR_OPEN")
        if defrost_stuck and self.defrost_stuck_s >= 2700:
            alarms.append("DEFROST_TIMEOUT")
        self.alarms = tuple(alarms)
        self.return_c = self.supply_c + k * (pulp_c - self.supply_c) + (0.0 if door_open else leak)

    @property
    def mean_air_c(self) -> float:
        """What the fruit sees: the average of supply and return air."""
        return (self.supply_c + self.return_c) / 2
