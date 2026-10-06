"""`bbc sim telemetry` - drive a scenario's devices through the IoT webhook.

    bbc sim telemetry --scenario S-A --to http://127.0.0.1:8787/v1/telemetry
    bbc sim telemetry --scenario S-A --from-h 0 --minutes 10 --out .artifacts/sim/s-a.jsonl
    bbc sim telemetry --replay .artifacts/sim/s-a.jsonl --to http://127.0.0.1:8787/v1/telemetry

Readings carry simulated timestamps anchored on the truck's departure (--depart,
default: now, on the 5-minute grid). The ground truth is written to --truth-out and
never sent anywhere.
"""

from __future__ import annotations

import argparse
import json
from collections import Counter
from datetime import UTC, datetime, timedelta
from itertools import groupby
from pathlib import Path
from typing import Any

from blueberrychain import snowcall
from blueberrychain.sim import telemetry as tm
from blueberrychain.sim import trip as tp
from blueberrychain.sim import world as world_mod
from blueberrychain.sim.clock import SimClock, floor_to, iso, utc

DEFAULT_URL = "http://127.0.0.1:8787/v1/telemetry"
TRUTH_DIR = Path(".artifacts/sim/truth")


def _fault_override(text: str) -> tuple[str, str, float]:
    try:
        name, value = text.split("=", 1)
        fault, param = name.split(".", 1)
        return fault, param, float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "expected <fault>.<param>=<number>, "
            f"e.g. reefer_compressor_failure.duration_h=2.5: {text}"
        ) from exc


def add_sim_telemetry(parser: argparse.ArgumentParser) -> None:
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--scenario", choices=["S-A", "S-B"], help="Scenario to simulate.")
    source.add_argument("--replay", type=Path, help="Send messages from a JSONL file instead.")
    parser.add_argument(
        "--depart", type=utc, default=None, help="Departure time (ISO, default now)."
    )
    parser.add_argument(
        "--fault",
        type=_fault_override,
        action="append",
        default=[],
        metavar="FAULT.PARAM=VALUE",
        help="Override a fault parameter (repeatable).",
    )
    parser.add_argument("--cold-store-days", type=float, default=None)
    parser.add_argument("--seed", type=int, default=None, help="Default: world.yaml meta.seed.")
    parser.add_argument(
        "--from-h",
        type=float,
        default=None,
        help="Only messages from this many hours after departure (negative = before).",
    )
    parser.add_argument(
        "--minutes", type=float, default=None, help="Only this many minutes of messages."
    )
    parser.add_argument("--to", default=None, help=f"Webhook URL (e.g. {DEFAULT_URL}).")
    parser.add_argument("--out", type=Path, default=None, help="Also write the messages as JSONL.")
    parser.add_argument("--truth-out", type=Path, default=None)
    parser.add_argument(
        "--pace",
        choices=["fast", "live"],
        default="fast",
        help="live: wall-clock paced at world meta.clock_factor.",
    )
    parser.add_argument("--batch-size", type=int, default=200)


def _messages(
    args: argparse.Namespace, world: dict[str, Any]
) -> tuple[list[dict[str, Any]], dict | None]:
    if args.replay:
        lines = args.replay.read_text(encoding="utf-8").splitlines()
        return [json.loads(line) for line in lines if line.strip()], None
    depart = args.depart or floor_to(datetime.now(UTC), 300)
    overrides: dict[str, dict[str, float]] = {}
    for fault, param, value in args.fault:
        overrides.setdefault(fault, {})[param] = value
    trip = tp.scenario_trip(world, args.scenario, depart, overrides, args.cold_store_days)
    result = tm.simulate(world, trip, args.seed)
    start = depart + timedelta(hours=args.from_h) if args.from_h is not None else None
    end = (
        (start or trip.start) + timedelta(minutes=args.minutes)
        if args.minutes is not None
        else None
    )
    truth = {
        **result.truth,
        "depart_at": iso(depart),
        "faults": [
            {
                "kind": f.kind,
                "target": f.target,
                "params": f.params,
                "start": iso(f.start) if f.start else None,
                "end": iso(f.end) if f.end else None,
            }
            for f in trip.faults
        ],
    }
    return tm.window(result.messages, start, end), truth


def run_sim_telemetry(args: argparse.Namespace) -> int:
    world = world_mod.load_world()
    try:
        messages, truth = _messages(args, world)
    except ValueError as exc:
        print(exc)
        return 2
    if not messages:
        print("no messages in the requested window")
        return 1
    devices = Counter(m["device_id"] for m in messages)
    print(
        f"{len(messages)} messages, {messages[0]['ts']} .. {messages[-1]['ts']}: "
        + ", ".join(f"{d} x{n}" for d, n in sorted(devices.items()))
    )
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text("".join(json.dumps(m) + "\n" for m in messages), encoding="utf-8")
        print(f"wrote {args.out.as_posix()}")
    if truth is not None:
        path = args.truth_out or TRUTH_DIR / f"{args.scenario}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(truth, indent=2) + "\n", encoding="utf-8")
        print(f"ground truth -> {path.as_posix()} (never sent to Snowflake)")
    if not args.to:
        return 0
    secret = snowcall.load_env().get("BBC_IOT_HMAC_SECRET")
    if not secret:
        print("BBC_IOT_HMAC_SECRET is not set (see .env.example)")
        return 2
    if args.pace == "live":
        # One reading instant at a time, released when simulated time reaches it.
        clock = SimClock(start=utc(messages[0]["ts"]), factor=float(world["meta"]["clock_factor"]))
        clock.begin()
        report = tm.DeliveryReport()
        for ts, group in groupby(messages, key=lambda m: m["ts"]):
            clock.wait_until(utc(ts))
            part = tm.post_messages(args.to, secret, list(group), batch_size=args.batch_size)
            report.batches += part.batches
            report.sent += part.sent
            report.accepted += part.accepted
            report.rejected.extend(part.rejected)
    else:
        report = tm.post_messages(args.to, secret, messages, batch_size=args.batch_size)
    print(
        f"delivered {report.sent} in {report.batches} batch(es): accepted {report.accepted}, "
        f"rejected {len(report.rejected)}"
    )
    for reject in report.rejected[:10]:
        print(f"  rejected {reject.get('device_id')} {reject.get('ts')}: {reject.get('errors')}")
    return 0 if not report.rejected else 1
