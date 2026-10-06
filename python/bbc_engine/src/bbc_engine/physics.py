"""Shelf-life physics: the reference implementation every other copy must match.

The OPS Dynamic Tables (``snowflake/modules/62_ops_thermal.sql``), the SQL UDFs
``OPS.SHELF_LIFE_RATE`` / ``OPS.PROJECT_SHELF_LIFE_DAYS`` and the evaluation engine all
compute these quantities. Parity tests compare them with this module.

Model
-----
* ``rate(T) = Q10 ** ((T - Tref) / 10)``: how many hours of shelf life at the reference
  temperature one hour at ``T`` uses up. ``rate(Tref) = 1``.
* A reading taken at ``reading_ts`` with ``interval_s`` stands for the interval
  ``(reading_ts - interval_s, reading_ts]``, so it is attributed to the device assignment and
  custody holder in force just *before* ``reading_ts``. Only the lot's PRIMARY pulp probe counts.
* **Consumed life** (reference hours) = ``sum(rate(T) * interval_h)``.
* **Excess life** (reference hours) = ``sum(max(rate(T) - rate(threshold), 0) * interval_h)``:
  the part of the loss that staying at the threshold would have avoided. Custody
  attribution splits this quantity, not consumed life - and only the *attributable* part:
  readings inside the grower's contractual pre-cooling window (harvest +
  ``precool_max_hours``) are field heat nobody could avoid, so they count toward the
  physics but not toward any holder's share.
* **Breach minutes**: interval minutes of readings strictly above the threshold;
  **degree-minutes above** = ``sum(max(T - threshold, 0) * interval_min)``.
* **Remaining shelf life** as of the last reading:
  ``ref_life_h - consumed_h - unmonitored_h * rate(T_assumed)``, where
  ``unmonitored_h = max(elapsed_h - monitored_h, 0)`` and ``elapsed_h`` runs from harvest to
  the last reading. Time without readings is charged at a conservative assumed temperature.
* **Projection**: ``(remaining_h - hours_ahead * rate(T_expected)) / 24`` days.

The model never reads "now": every state is *as of the last reading*, so it is
reproducible and can be computed inside a Dynamic Table.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime


def rate(temp_c: float, tref_c: float, q10: float) -> float:
    """Relative rate of shelf-life consumption at ``temp_c`` (1.0 at the reference temperature)."""
    return q10 ** ((temp_c - tref_c) / 10.0)


@dataclass(frozen=True)
class ShelfLifeModel:
    """The per-product parameters (REF.PRODUCTS) the physics needs."""

    ref_shelf_life_days: float
    tref_c: float
    q10: float
    threshold_c: float
    unmonitored_assumed_temp_c: float

    @classmethod
    def from_product(cls, product: Mapping[str, object]) -> ShelfLifeModel:
        return cls(
            ref_shelf_life_days=float(product["ref_shelf_life_days"]),  # type: ignore[arg-type]
            tref_c=float(product["tref_c"]),  # type: ignore[arg-type]
            q10=float(product["q10"]),  # type: ignore[arg-type]
            threshold_c=float(product["threshold_c"]),  # type: ignore[arg-type]
            unmonitored_assumed_temp_c=float(product["unmonitored_assumed_temp_c"]),  # type: ignore[arg-type]
        )

    @property
    def ref_life_h(self) -> float:
        return self.ref_shelf_life_days * 24.0

    def rate(self, temp_c: float) -> float:
        return rate(temp_c, self.tref_c, self.q10)


@dataclass(frozen=True)
class Reading:
    ts: datetime
    interval_s: int
    temp_c: float
    holder: str | None = None


@dataclass(frozen=True)
class ReadingEffect:
    reading_min: float
    consumed_h: float
    excess_h: float
    breach_min: float
    degree_min_above: float


def reading_effect(temp_c: float, interval_s: int, model: ShelfLifeModel) -> ReadingEffect:
    """What one reading contributes (the per-row columns of OPS.TELEMETRY_ASSIGNED)."""
    if interval_s <= 0:
        raise ValueError("interval_s must be positive")
    hours = interval_s / 3600.0
    minutes = interval_s / 60.0
    r = model.rate(temp_c)
    above = max(temp_c - model.threshold_c, 0.0)
    return ReadingEffect(
        reading_min=minutes,
        consumed_h=r * hours,
        excess_h=max(r - model.rate(model.threshold_c), 0.0) * hours,
        breach_min=minutes if temp_c > model.threshold_c else 0.0,
        degree_min_above=above * minutes,
    )


@dataclass(frozen=True)
class ThermalTotals:
    readings: int
    monitored_min: float
    consumed_h: float
    excess_h: float
    breach_min: float
    degree_min_above: float
    max_temp_c: float | None
    first_ts: datetime | None
    last_ts: datetime | None


def totals(readings: Iterable[Reading], model: ShelfLifeModel) -> ThermalTotals:
    rows = sorted(readings, key=lambda r: r.ts)
    effects = [reading_effect(r.temp_c, r.interval_s, model) for r in rows]
    return ThermalTotals(
        readings=len(rows),
        monitored_min=sum(e.reading_min for e in effects),
        consumed_h=sum(e.consumed_h for e in effects),
        excess_h=sum(e.excess_h for e in effects),
        breach_min=sum(e.breach_min for e in effects),
        degree_min_above=sum(e.degree_min_above for e in effects),
        max_temp_c=max((r.temp_c for r in rows), default=None),
        first_ts=rows[0].ts if rows else None,
        last_ts=rows[-1].ts if rows else None,
    )


@dataclass(frozen=True)
class LotThermalState:
    """One row of OPS.LOT_THERMAL_STATE."""

    as_of: datetime | None
    elapsed_h: float
    monitored_h: float
    unmonitored_h: float
    consumed_h: float
    excess_h: float
    remaining_shelf_life_h: float
    remaining_shelf_life_days: float
    monitoring_coverage_pct: float | None
    temperature_compliance_pct: float | None
    breach_min: float
    degree_min_above: float
    max_temp_c: float | None


def remaining_shelf_life_h(
    model: ShelfLifeModel, consumed_h: float, monitored_h: float, elapsed_h: float
) -> float:
    unmonitored_h = max(elapsed_h - monitored_h, 0.0)
    return (
        model.ref_life_h - consumed_h - unmonitored_h * model.rate(model.unmonitored_assumed_temp_c)
    )


def lot_state(
    model: ShelfLifeModel, harvest_at: datetime, readings: Iterable[Reading]
) -> LotThermalState:
    t = totals(readings, model)
    as_of = t.last_ts
    elapsed_h = max((as_of - harvest_at).total_seconds() / 3600.0, 0.0) if as_of else 0.0
    monitored_h = t.monitored_min / 60.0
    unmonitored_h = max(elapsed_h - monitored_h, 0.0)
    remaining_h = remaining_shelf_life_h(model, t.consumed_h, monitored_h, elapsed_h)
    return LotThermalState(
        as_of=as_of,
        elapsed_h=elapsed_h,
        monitored_h=monitored_h,
        unmonitored_h=unmonitored_h,
        consumed_h=t.consumed_h,
        excess_h=t.excess_h,
        remaining_shelf_life_h=remaining_h,
        remaining_shelf_life_days=remaining_h / 24.0,
        monitoring_coverage_pct=min(monitored_h / elapsed_h, 1.0) * 100.0 if elapsed_h else None,
        temperature_compliance_pct=(1.0 - t.breach_min / t.monitored_min) * 100.0
        if t.monitored_min
        else None,
        breach_min=t.breach_min,
        degree_min_above=t.degree_min_above,
        max_temp_c=t.max_temp_c,
    )


@dataclass(frozen=True)
class HolderExposure:
    """One row of OPS.LOT_CUSTODY_EXPOSURE."""

    holder: str
    excess_h: float
    attributable_excess_h: float
    consumed_h: float
    breach_min: float
    degree_min_above: float
    excess_life_share: float | None  # None when the lot has no attributable excess at all


def custody_exposure(
    readings: Iterable[Reading], model: ShelfLifeModel, attributable_after: datetime | None = None
) -> dict[str, HolderExposure]:
    """Split a lot's physics by custody holder; shares of attributable excess sum to 1.

    ``attributable_after`` ends the grower's contractual pre-cooling window (harvest +
    ``precool_max_hours``): field heat inside it is expected and nobody's fault, so
    readings at or before it count toward physics but not toward attribution.
    """
    by_holder: dict[str, list[Reading]] = {}
    for r in readings:
        if r.holder is None:
            raise ValueError("every reading needs a custody holder for attribution")
        by_holder.setdefault(r.holder, []).append(r)
    sums = {h: totals(rows, model) for h, rows in by_holder.items()}
    attributable = {
        h: totals(
            [r for r in rows if attributable_after is None or r.ts > attributable_after], model
        ).excess_h
        for h, rows in by_holder.items()
    }
    total = sum(attributable.values())
    return {
        h: HolderExposure(
            holder=h,
            excess_h=t.excess_h,
            attributable_excess_h=attributable[h],
            consumed_h=t.consumed_h,
            breach_min=t.breach_min,
            degree_min_above=t.degree_min_above,
            excess_life_share=attributable[h] / total if total > 0 else None,
        )
        for h, t in sorted(sums.items())
    }


def project_shelf_life_days(
    remaining_h: float, hours_ahead: float, temp_c: float, tref_c: float, q10: float
) -> float:
    """Remaining shelf life (days) after ``hours_ahead`` more hours at ``temp_c``."""
    return (remaining_h - hours_ahead * rate(temp_c, tref_c, q10)) / 24.0
