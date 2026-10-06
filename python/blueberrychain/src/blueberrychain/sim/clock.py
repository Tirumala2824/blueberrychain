"""Simulation time.

Everything the simulator produces carries *simulated* timestamps. Two pacings:

* ``fast``: emit as quickly as the pipeline accepts (backfill, tests, history before "now");
* ``live``: wall-clock paced at ``factor`` simulated seconds per real second
  (world.yaml ``meta.clock_factor``, default 60x), so a 15 h haul plays in 15 minutes.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta


def utc(text: str) -> datetime:
    moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if moment.tzinfo is None:
        raise ValueError(f"timestamp needs an offset: {text}")
    return moment.astimezone(UTC)


def iso(moment: datetime) -> str:
    """Webhook / contract timestamp form: second precision, UTC, 'Z'."""
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def floor_to(moment: datetime, seconds: int) -> datetime:
    epoch = int(moment.timestamp())
    return datetime.fromtimestamp(epoch - epoch % seconds, tz=UTC)


@dataclass
class SimClock:
    """Maps simulated time to wall-clock time for live pacing."""

    start: datetime
    factor: float = 60.0
    sleep: Callable[[float], None] = time.sleep
    monotonic: Callable[[], float] = time.monotonic
    _t0: float | None = field(default=None, repr=False)

    def begin(self) -> None:
        self._t0 = self.monotonic()

    def now(self) -> datetime:
        if self._t0 is None:
            return self.start
        return self.start + timedelta(seconds=(self.monotonic() - self._t0) * self.factor)

    def wait_until(self, moment: datetime) -> None:
        """Block until simulated time reaches ``moment`` (no-op when already past)."""
        if self._t0 is None:
            self.begin()
        delay = (moment - self.now()).total_seconds() / self.factor
        if delay > 0:
            self.sleep(delay)
