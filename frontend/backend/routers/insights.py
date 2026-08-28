from __future__ import annotations

"""Scenario AI insights router — OpenAI via the AI client module.

The Python rule engine in scenarios.py owns all calculations.
This router forwards already-computed results to OpenAI for interpretation.

Two endpoints:
  POST /api/scenarios/insights       — compute insights only (no auth required)
  POST /api/scenarios/insights/save  — compute + persist to scenario_runs (auth required)
"""

import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Any, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import ai_client
from supabase_client import get_supabase
from auth0 import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


class ConcernResultIn(BaseModel):
    level: str
    reason: str


class VariableChangeIn(BaseModel):
    key: str
    label: str
    unit: str
    before: float
    after: float
    changed: bool


class ScenarioInsightsRequest(BaseModel):
    mission_id: str | None = None
    mission_context: str | None = None      # mission description text, if available
    concerns_before: dict[str, ConcernResultIn]
    concerns_after: dict[str, ConcernResultIn]
    changes: list[VariableChangeIn]


class ScenarioInsightsResponse(BaseModel):
    mission_id: str | None
    insights: dict[str, Any] | None
    ai_available: bool
    error: str | None
    saved: Optional[bool] = None
    save_error: Optional[str] = None


def _persist_insights(mission_id: str, auth0_sub: str, insights: Optional[dict]) -> tuple[bool, Optional[str]]:
    """Save AI insights onto the existing scenario_runs row for this mission."""
    if not insights:
        return False, "No insights provided to persist"
    try:
        sb = get_supabase()
        # Verify mission ownership before writing
        mission = (
            sb.table("missions")
            .select("id")
            .eq("id", mission_id)
            .eq("auth0_sub", auth0_sub)
            .limit(1)
            .execute()
        )
        if not mission.data:
            logger.warning(
                "DB persist insights rejected: mission %s not found or access denied for user %s",
                mission_id,
                auth0_sub,
            )
            return False, "Mission not found or unauthorized"
        # Update the insights column on the scenario_runs row
        sb.table("scenario_runs").update({"insights": insights}).eq("mission_id", mission_id).execute()
        logger.info("Successfully persisted insights for mission %s", mission_id)
        return True, None
    except Exception as exc:
        logger.error("Database error persisting insights for mission %s: %s", mission_id, exc, exc_info=True)
        return False, f"Database persistence failed: {exc}"


@router.post("/insights", response_model=ScenarioInsightsResponse)
async def scenario_insights(payload: ScenarioInsightsRequest) -> ScenarioInsightsResponse:
    """
    Send calculated scenario results to OpenAI for plain-language interpretation.
    Python owns the numbers; the AI owns the explanation.
    Degrades gracefully if AI is unavailable.
    Does NOT persist — use /insights/save to also store results.
    """
    result = ai_client.scenario_insights(
        concerns_before={k: v.model_dump() for k, v in payload.concerns_before.items()},
        concerns_after={k: v.model_dump() for k, v in payload.concerns_after.items()},
        changes=[c.model_dump() for c in payload.changes],
        mission_context=payload.mission_context,
    )
    return ScenarioInsightsResponse(
        mission_id=payload.mission_id,
        insights=result["insights"],
        ai_available=result["ai_available"],
        error=result["error"],
    )


@router.post("/insights/save", response_model=ScenarioInsightsResponse)
async def scenario_insights_and_save(
    payload: ScenarioInsightsRequest,
    current_user: dict = Depends(get_current_user),
) -> ScenarioInsightsResponse:
    """
    Generate AI insights AND persist them to the scenario_runs row.
    Requires authentication. Used when a missionId is present so insights
    survive across devices and browser sessions.
    """
    result = ai_client.scenario_insights(
        concerns_before={k: v.model_dump() for k, v in payload.concerns_before.items()},
        concerns_after={k: v.model_dump() for k, v in payload.concerns_after.items()},
        changes=[c.model_dump() for c in payload.changes],
        mission_context=payload.mission_context,
    )
    saved: Optional[bool] = None
    save_error: Optional[str] = None

    if payload.mission_id and result["insights"]:
        saved, save_error = _persist_insights(payload.mission_id, current_user["sub"], result["insights"])

    return ScenarioInsightsResponse(
        mission_id=payload.mission_id,
        insights=result["insights"],
        ai_available=result["ai_available"],
        error=result["error"],
        saved=saved,
        save_error=save_error,
    )
