"""Thin HTTP wrapper over the deterministic bbc_engine (Cloud Run).

The engine owns every number; this service only validates transport, delegates to
`bbc_engine.engine.evaluate` and returns its output unchanged. No state, no secrets.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from bbc_engine import __version__
from bbc_engine.context import EngineContext
from bbc_engine.engine import evaluate

logging.basicConfig(level=logging.INFO, format='{"severity":"%(levelname)s","message":"%(message)s"}')
log = logging.getLogger("engine-api")

app = FastAPI(title="BlueberryChain engine API", version=__version__)


class EvaluateRequest(BaseModel):
    pack: dict[str, Any] = Field(description="Evidence pack (must include content_hash)")
    context: dict[str, Any] = Field(description="EngineContext fields (params, router_rules, ...)")
    option_id_start: int
    finding: dict[str, Any] | None = None
    samples: int | None = None
    rec_id: str | None = None
    generated_at: str | None = None


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "engine_version": __version__}


@app.post("/evaluate")
def evaluate_case(req: EvaluateRequest) -> dict[str, Any]:
    try:
        ctx = EngineContext(**req.context)
        result = evaluate(
            req.pack,
            ctx,
            option_id_start=req.option_id_start,
            finding=req.finding,
            samples=req.samples,
            rec_id=req.rec_id,
            generated_at=req.generated_at,
        )
    except (TypeError, KeyError, ValueError) as exc:
        # Bad or incomplete input: refuse rather than guess (never invent data).
        log.warning("evaluate rejected: %s", exc)
        raise HTTPException(status_code=422, detail=f"invalid input: {exc}") from exc
    return {
        "engine_version": __version__,
        "options": result.options,
        "draft_brief": result.draft_brief,
        "understanding_triggers": result.understanding_triggers,
        "escalation_reasons": result.escalation_reasons,
        "decision": result.decision,
        "brief": result.brief,
    }
