"""Shared fixtures: the simulator's world, policy v1, and the Phase 11 worked-example pack.

The engine itself is dependency-free; its tests borrow the world (blueberrychain) and the
contract validators (bbc_toolkit) from the workspace.
"""

import copy
import json
from pathlib import Path

import pytest
from bbc_engine.context import EngineContext
from bbc_engine.engine import evaluate
from bbc_toolkit import contracts
from blueberrychain.sim import world as world_mod

ROOT = Path(__file__).resolve().parents[3]
POLICY = ROOT / "snowflake" / "seed" / "policy" / "v1.json"


@pytest.fixture(scope="session")
def world():
    return world_mod.load_world()


@pytest.fixture(scope="session")
def policy():
    return json.loads(POLICY.read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def ctx(world, policy):
    return EngineContext.from_world(world, policy)


@pytest.fixture(scope="session")
def fixture_pack():
    """The contract fixture as written: the reefer's compressor alarm is still active."""
    with (contracts.contracts_dir() / "fixtures" / "evidence_pack.json").open(
        encoding="utf-8"
    ) as fh:
        return json.load(fh)["valid"][0]


def cleared(pack):
    """The worked example proper: the excursion is over (the driver reset the unit)."""
    out = copy.deepcopy(pack)
    out["shipment"]["reefer_state"].update({"alarms": [], "supply_air_c": 0.6, "return_air_c": 1.9})
    return out


@pytest.fixture
def pack(fixture_pack):
    return cleared(fixture_pack)


@pytest.fixture(scope="session")
def worked(fixture_pack, ctx):
    """The golden evaluation (full sample count), shared read-only across tests."""
    return evaluate(cleared(fixture_pack), ctx, option_id_start=101)
