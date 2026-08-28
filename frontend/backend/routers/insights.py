from __future__ import annotations

"""Scenario AI insights router — OpenAI via the AI client module.

The Python rule engine in scenarios.py owns all calculations.
This router forwards already-computed results to OpenAI for interpretation.

Two endpoints:
  POST /api/scenarios/insights       — compute insights only (no auth required)
  POST /api/scenarios/insights/save  — compute + persist to scenario_runs (auth required)
"""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Any, Optional
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
import ai_client
from supabase_client import get_supabase
from auth0 import get_current_user

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


def _persist_insights(mission_id: str, auth0_sub: str, insights: Optional[dict]) -> None:
    """Save AI insights onto the existing scenario_runs row for this mission.

    Silently no-ops if the scenario run doesn't exist yet or ownership fails —
    insights are supplementary and must never block the response.
    """
    if not insights:
        return
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
            return
        # Update the insights column on the scenario_runs row
        sb.table("scenario_runs").update({"insights": insights}).eq("mission_id", mission_id).execute()
    except Exception:  # noqa: BLE001
        pass


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
    if payload.mission_id and result["insights"]:
        _persist_insights(payload.mission_id, current_user["sub"], result["insights"])
    return ScenarioInsightsResponse(
        mission_id=payload.mission_id,
        insights=result["insights"],
        ai_available=result["ai_available"],
        error=result["error"],
    )
