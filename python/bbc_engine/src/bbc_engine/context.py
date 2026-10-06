"""Everything the engine reads besides the evidence pack: governed parameters and
reference data, loaded at the versions the pack records (so a replay is exact).

The pack holds the facts of the case (shelf life, custody, orders, inventory,
destinations, deadlines); the context holds the rules and prices of the world
(policy parameters, product physics, contract terms, cost rates, lanes).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Engine constants: physical and operational assumptions, overridable by policy parameters.
DEFAULTS: dict[str, float] = {
    "dispatch_lead_min": 15,  # from decision to the instruction reaching the truck
    "replacement_lead_h": 2.0,  # pick and load a replacement lot at a DC
    "inspection_delay_h": 4.0,  # QC hold at the inspection site
    "inspection_sigma_days": 0.5,  # how well an inspection reveals true shelf life
    "reefer_pulp_tau_h": 10.0,  # loaded trailer: pulp follows air slowly
    "dc_pulp_tau_h": 4.0,  # DC cold room
    "setpoint_offset_c": 0.3,  # pulp settles slightly above setpoint
    "dc_room_c": 0.5,
    "fault_duration_min_h": 0.5,  # if a reefer fault persists, for how much longer
    "fault_duration_max_h": 4.0,
    "fault_air_tau_h": 3.0,  # a failed unit's trailer air drifts to ambient over hours
    "expedite_transit_factor": 0.8,  # team drivers, no rest stops
    "pallets_per_truck": 20,
    "claim_notice_min_share": 0.5,  # notice is given when one external holder has at least this
    "missing_bol_setpoint_factor": 0.2,  # carrier liability without a BOL setpoint is weak
    "p_collect_default": 0.9,
    "decision_margin_days": 0.5,  # inspection re-decides only with this much spec margin
}


@dataclass(frozen=True)
class EngineContext:
    params: dict[str, Any]
    router_rules: list[dict[str, Any]]
    products: dict[str, dict[str, Any]]
    contracts: list[dict[str, Any]]
    cost_rates: list[dict[str, Any]]
    lanes: list[dict[str, Any]]
    sites: dict[str, dict[str, Any]] = field(default_factory=dict)
    parties: dict[str, dict[str, Any]] = field(default_factory=dict)
    p_collect: dict[str, float] = field(default_factory=dict)
    policy_version: str = "1"

    @classmethod
    def from_world(cls, world: dict[str, Any], policy: dict[str, Any]) -> EngineContext:
        """The simulator's world and a policy document (tests, simulation, replay)."""
        return cls(
            params=policy["parameters"],
            router_rules=policy["router_rules"],
            products={p["product_id"]: p for p in world["products"]},
            contracts=world["contracts"],
            cost_rates=world["cost_rates"],
            lanes=world["lanes"],
            sites={s["site_id"]: s for s in world["sites"]},
            parties={p["party_id"]: p for p in world["parties"]},
            policy_version=str(policy["policy_version"]),
        )

    def p(self, name: str) -> Any:
        """A policy parameter, falling back to the engine default."""
        if name in self.params:
            return self.params[name]
        return DEFAULTS[name]

    def router(self, trigger: str) -> dict[str, Any] | None:
        rule = next((r for r in self.router_rules if r.get("trigger") == trigger), None)
        return rule if rule and rule.get("enabled", True) else None

    def lane(self, origin: str, dest: str) -> dict[str, Any] | None:
        return next(
            (
                lane
                for lane in self.lanes
                if lane["origin_site_id"] == origin and lane["dest_site_id"] == dest
            ),
            None,
        )

    def cost(self, cost_type: str, scope_id: str | None = None) -> float:
        """A cost rate: the site/lane-scoped one when present, else the global one."""
        rows = [c for c in self.cost_rates if c["cost_type"] == cost_type]
        scoped = [c for c in rows if scope_id and c.get("scope_id") == scope_id]
        chosen = scoped or [c for c in rows if c.get("scope_type") == "GLOBAL"] or rows
        return float(chosen[0]["rate"]) if chosen else 0.0

    def contract(self, party_id: str, contract_type: str) -> dict[str, Any]:
        found = next(
            (
                c
                for c in self.contracts
                if c["party_id"] == party_id and c["contract_type"] == contract_type
            ),
            None,
        )
        return dict(found["terms"]) if found else {}

    def truck_kg(self, product_id: str) -> float:
        per_pallet = float(self.products.get(product_id, {}).get("kg_per_pallet") or 1050)
        return per_pallet * float(self.p("pallets_per_truck"))

    def lane_freight(self, origin: str, dest: str, kg: float, product_id: str) -> float | None:
        """A part-load's share of the lane's cost per load."""
        lane = self.lane(origin, dest)
        if lane is None:
            return None
        return float(lane["cost_per_load_usd"]) * min(kg / self.truck_kg(product_id), 1.0)
