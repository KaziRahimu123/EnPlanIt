from __future__ import annotations

"""Mission analysis router — OpenAI / IBM Granite via the AI client module.

Extends the original analysis with optional persistence: when a mission_id
is supplied and the user is authenticated, results are saved to Supabase.
Document evidence from uploaded docs is incorporated when available.
"""

import logging
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Any, Optional
from datetime import datetime, timezone

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import ai_client
from supabase_client import get_supabase
from auth0 import get_current_user

logger = logging.getLogger(__name__)

router = APIRouter()


class MissionAnalysisRequest(BaseModel):
    mission_id: str | None = None
    description: str = Field(..., min_length=10)


class MissionAnalysisResponse(BaseModel):
    mission_id: str | None
    extracted: dict[str, Any] | None
    plan: dict[str, Any] | None
    ai_available: bool
    error: str | None
    saved: Optional[bool] = None
    save_error: Optional[str] = None


def _save_analysis(
    mission_id: str,
    auth0_sub: str,
    extracted: Optional[dict],
    plan: Optional[dict],
) -> tuple[bool, Optional[str]]:
    """Persist analysis results to Supabase. Logs failures and returns persistence confirmation."""
    try:
        sub = (auth0_sub or "").strip()
        if not sub:
            return False, "Authentication required"
        mission = (
            sb.table("missions")
            .select("id")
            .eq("id", mission_id)
            .eq("auth0_sub", sub)
            .limit(1)
            .execute()
        )
        if not mission.data:
            logger.warning(
                "DB save analysis rejected: mission %s not found or access denied for user %s",
                mission_id,
                auth0_sub,
            )
            return False, "Mission not found or unauthorized"

        if extracted is None or plan is None:
            logger.warning(
                "DB save analysis skipped: missing extracted or plan payload for mission %s",
                mission_id,
            )
            return False, "Missing extraction or flight plan data"

        now = datetime.now(timezone.utc).isoformat()

        # Update extracted fields on the mission row
        sb.table("missions").update({
            "destination": extracted.get("destination"),
            "mission_type": extracted.get("mission_type"),
            "objective": extracted.get("objective"),
            "duration": extracted.get("duration"),
            "power_source": extracted.get("power_source"),
            "known_resources": extracted.get("known_resources"),
            "updated_at": now,
        }).eq("id", mission_id).execute()

        # Upsert into mission_analyses table
        existing = (
            sb.table("mission_analyses")
            .select("id")
            .eq("mission_id", mission_id)
            .limit(1)
            .execute()
        )
        analysis_data = {
            "mission_id": mission_id,
            "auth0_sub": auth0_sub,
            "mission_summary": plan.get("mission_summary"),
            "objectives": plan.get("objectives"),
            "required_resources": plan.get("required_resources"),
            "major_constraints": plan.get("major_constraints"),
            "planning_considerations": plan.get("planning_considerations"),
            "missing_information": plan.get("missing_information"),
            "analyzed_at": now,
            "updated_at": now,
        }
        if existing.data:
            sb.table("mission_analyses").update(analysis_data).eq("mission_id", mission_id).execute()
        else:
            sb.table("mission_analyses").insert(analysis_data).execute()

        # Also keep denormalized plan fields on the mission row for seamless retrieval
        sb.table("missions").update({
            "mission_summary": plan.get("mission_summary"),
            "objectives": plan.get("objectives"),
            "required_resources": plan.get("required_resources"),
            "major_constraints": plan.get("major_constraints"),
            "planning_considerations": plan.get("planning_considerations"),
            "missing_information": plan.get("missing_information"),
        }).eq("id", mission_id).execute()

        logger.info("Successfully persisted mission analysis for mission %s", mission_id)
        return True, None

    except Exception as exc:
        logger.error("Database error saving analysis for mission %s: %s", mission_id, exc, exc_info=True)
        return False, f"Database persistence failed: {exc}"


def _get_document_evidence(mission_id: str, auth0_sub: str) -> str:
    """
    Retrieve extracted document facts and full document chunks for this mission
    to use as rich evidence in the AI analysis prompt.
    """
    try:
        sb = get_supabase()
        
        # 1. Fetch extracted facts
        facts_res = (
            sb.table("document_facts")
            .select("label, value, state, source_text, unit")
            .eq("mission_id", mission_id)
            .neq("state", "not_specified")
            .execute()
        )
        facts = facts_res.data or []

        # 2. Fetch full document text chunks
        chunks_res = (
            sb.table("document_chunks")
            .select("text, page_number")
            .eq("mission_id", mission_id)
            .order("chunk_index")
            .limit(12)
            .execute()
        )
        chunks = chunks_res.data or []

        if not facts and not chunks:
            return ""

        parts = []
        if chunks:
            doc_text = "\n\n".join(c["text"] for c in chunks if c.get("text"))
            if doc_text.strip():
                parts.append(f"Full Uploaded Mission Dossier Text:\n---\n{doc_text[:5000]}\n---")

        if facts:
            lines = ["Verified Telemetry Facts from Documents:"]
            for f in facts:
                state_tag = f"[{f['state'].upper()}]"
                value_str = f"{f['value']} {f.get('unit') or ''}".strip() if f.get("value") else "—"
                source_str = f' (Source: "{f["source_text"][:120]}")' if f.get("source_text") else ""
                lines.append(f"  {state_tag} {f['label']}: {value_str}{source_str}")
            parts.append("\n".join(lines))

        return "\n\n".join(parts)
    except Exception as exc:
        logger.warning("Error fetching document evidence: %s", exc)
        return ""


@router.post("/analyze", response_model=MissionAnalysisResponse)
async def analyze_mission(
    payload: MissionAnalysisRequest,
) -> MissionAnalysisResponse:
    """
    Extract mission parameters and generate a preliminary plan using OpenAI.
    Degrades gracefully if AI is unavailable — never returns 500 for AI failures.
    No DB persistence on this endpoint (use /analyze/save for that).
    """
    result = ai_client.analyze_mission(payload.description)
    return MissionAnalysisResponse(
        mission_id=payload.mission_id,
        extracted=result["extracted"],
        plan=result["plan"],
        ai_available=result["ai_available"],
        error=result["error"],
    )


@router.post("/analyze/save", response_model=MissionAnalysisResponse)
async def analyze_mission_and_save(
    payload: MissionAnalysisRequest,
    current_user: dict = Depends(get_current_user),
) -> MissionAnalysisResponse:
    """
    Run analysis AND persist results to Supabase. Requires authentication.
    Incorporates document evidence when available.
    """
    # Augment description with document evidence if mission has uploaded docs
    description = payload.description
    if payload.mission_id:
        doc_evidence = _get_document_evidence(payload.mission_id, current_user["sub"])
        if doc_evidence:
            description = (
                f"{description}\n\n"
                f"--- Document Evidence (treat as supporting context, not confirmed facts) ---\n"
                f"{doc_evidence}"
            )

    result = ai_client.analyze_mission(description)
    saved: Optional[bool] = None
    save_error: Optional[str] = None

    if payload.mission_id and result["ai_available"]:
        saved, save_error = _save_analysis(
            payload.mission_id,
            current_user["sub"],
            result["extracted"],
            result["plan"],
        )

    return MissionAnalysisResponse(
        mission_id=payload.mission_id,
        extracted=result["extracted"],
        plan=result["plan"],
        ai_available=result["ai_available"],
        error=result["error"],
        saved=saved,
        save_error=save_error,
    )


@router.get("/status")
async def ai_status() -> dict:
    """Report whether AI credentials are configured and which model and provider are active."""
    return {
        "ai_available": ai_client.credentials_configured(),
        "model": ai_client.active_model(),
        "provider": ai_client.active_provider(),
        "granite_active": ai_client.granite_configured(),
    }
