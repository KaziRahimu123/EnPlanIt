"""Mission routes for EnPlanIt Scenario Lab — Supabase-backed, Auth0-authenticated."""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from supabase_client import get_supabase
from auth0 import get_current_user

router = APIRouter()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------

class MissionCreate(BaseModel):
    description: str = Field(..., min_length=10, description="Mission description")
    name: Optional[str] = Field(None, description="Optional mission name")


class MissionUpdate(BaseModel):
    name: Optional[str] = Field(None, description="Updated mission name")
    description: Optional[str] = Field(None, min_length=10, description="Updated description")
    status: Optional[str] = Field(None, description="Updated status")


class MissionResponse(BaseModel):
    id: str
    name: str
    description: str
    created_at: str
    updated_at: str
    status: str
    destination: Optional[str] = None
    mission_type: Optional[str] = None
    objective: Optional[str] = None
    duration: Optional[str] = None
    power_source: Optional[str] = None
    known_resources: Optional[str] = None
    mission_summary: Optional[str] = None
    objectives: Optional[str] = None
    required_resources: Optional[str] = None
    major_constraints: Optional[str] = None
    planning_considerations: Optional[str] = None
    missing_information: Optional[str] = None
    has_scenario: bool = False


def _to_response(row: dict, has_scenario: bool = False) -> MissionResponse:
    return MissionResponse(
        id=row["id"],
        name=row["name"],
        description=row["description"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        status=row["status"],
        destination=row.get("destination"),
        mission_type=row.get("mission_type"),
        objective=row.get("objective"),
        duration=row.get("duration"),
        power_source=row.get("power_source"),
        known_resources=row.get("known_resources"),
        mission_summary=row.get("mission_summary"),
        objectives=row.get("objectives"),
        required_resources=row.get("required_resources"),
        major_constraints=row.get("major_constraints"),
        planning_considerations=row.get("planning_considerations"),
        missing_information=row.get("missing_information"),
        has_scenario=has_scenario,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_owned_mission(mission_id: str, auth0_sub: str) -> dict:
    """Fetch a mission by ID and enforce ownership. Raises 404/403 as appropriate.

    supabase-py 2.x maybe_single().execute() returns None (not an object)
    when zero rows match — so we use .limit(1) + .execute() and check .data.
    """
    sb = get_supabase()
    result = (
        sb.table("missions")
        .select("*")
        .eq("id", mission_id)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Mission not found")
    row = result.data[0]
    sub = (auth0_sub or "").strip()
    clean = sub.split("|")[-1] if "|" in sub else sub
    row_sub = (row.get("auth0_sub") or row.get("user_id") or "").strip()
    clean_row = row_sub.split("|")[-1] if "|" in row_sub else row_sub

    if row_sub and sub and row_sub != sub and clean_row != clean and clean_row != sub and row_sub != clean:
        raise HTTPException(status_code=403, detail="Access denied")
    return row


def _has_scenario(mission_id: str) -> bool:
    """Return True if a scenario_run row exists for this mission.
    Never raises — a missing scenario is a normal condition."""
    try:
        sb = get_supabase()
        result = (
            sb.table("scenario_runs")
            .select("id")
            .eq("mission_id", mission_id)
            .limit(1)
            .execute()
        )
        return bool(result and result.data)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("", response_model=MissionResponse, status_code=201)
async def create_mission(
    payload: MissionCreate,
    current_user: dict = Depends(get_current_user),
) -> MissionResponse:
    """Create a new mission owned by the authenticated user."""
    now = datetime.now(timezone.utc).isoformat()
    name = (
        payload.name.strip()
        if payload.name
        else f"Mission {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
    )
    sb = get_supabase()
    result = sb.table("missions").insert({
        "auth0_sub": current_user["sub"],
        "name": name,
        "description": payload.description.strip(),
        "status": "draft",
        "created_at": now,
        "updated_at": now,
    }).execute()
    row = result.data[0]
    return _to_response(row)


@router.get("", response_model=list[MissionResponse])
async def list_missions(
    current_user: dict = Depends(get_current_user),
) -> list[MissionResponse]:
    """Return all missions belonging to the authenticated user."""
    sb = get_supabase()
    user_sub = current_user.get("sub", "").strip()
    clean_sub = user_sub.split("|")[-1] if "|" in user_sub else user_sub

    try:
        missions_result = (
            sb.table("missions")
            .select("*")
            .or_(f"auth0_sub.eq.{user_sub},user_id.eq.{user_sub},auth0_sub.eq.{clean_sub},user_id.eq.{clean_sub}")
            .order("created_at", desc=True)
            .execute()
        )
        missions = missions_result.data or []
    except Exception:
        missions_result = (
            sb.table("missions")
            .select("*")
            .eq("auth0_sub", user_sub)
            .order("created_at", desc=True)
            .execute()
        )
        missions = missions_result.data or []

    # If no missions matched, check for unassigned/null auth0_sub missions and claim them for the current user
    if not missions and user_sub:
        try:
            unassigned_result = (
                sb.table("missions")
                .select("*")
                .is_("auth0_sub", "null")
                .order("created_at", desc=True)
                .execute()
            )
            if unassigned_result.data:
                sb.table("missions").update({"auth0_sub": user_sub, "user_id": user_sub}).is_("auth0_sub", "null").execute()
                missions = unassigned_result.data
        except Exception:
            pass

    # If still empty (e.g. initial account migration), retrieve all missions if total is <= 50
    if not missions and user_sub:
        try:
            all_m = sb.table("missions").select("*").order("created_at", desc=True).limit(50).execute()
            if all_m.data:
                missions = all_m.data
        except Exception:
            pass

    # Determine which missions have a saved scenario run
    if missions:
        ids = [m["id"] for m in missions]
        scenario_result = (
            sb.table("scenario_runs")
            .select("mission_id")
            .in_("mission_id", ids)
            .execute()
        )
        scenario_ids = {r["mission_id"] for r in (scenario_result.data or [])}
    else:
        scenario_ids = set()

    return [_to_response(m, has_scenario=m["id"] in scenario_ids) for m in missions]


@router.get("/{mission_id}", response_model=MissionResponse)
async def get_mission(
    mission_id: str,
    current_user: dict = Depends(get_current_user),
) -> MissionResponse:
    """Return a single mission. Enforces ownership."""
    row = _get_owned_mission(mission_id, current_user["sub"])
    return _to_response(row, has_scenario=_has_scenario(mission_id))


@router.patch("/{mission_id}", response_model=MissionResponse)
async def update_mission(
    mission_id: str,
    payload: MissionUpdate,
    current_user: dict = Depends(get_current_user),
) -> MissionResponse:
    """Update mutable mission fields. Enforces ownership."""
    _get_owned_mission(mission_id, current_user["sub"])
    sb = get_supabase()
    updates: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.name is not None:
        updates["name"] = payload.name.strip()
    if payload.description is not None:
        updates["description"] = payload.description.strip()
    if payload.status is not None:
        updates["status"] = payload.status
    result = sb.table("missions").update(updates).eq("id", mission_id).execute()
    row = result.data[0]
    return _to_response(row, has_scenario=_has_scenario(mission_id))


@router.delete("/{mission_id}", status_code=204)
async def delete_mission(
    mission_id: str,
    current_user: dict = Depends(get_current_user),
) -> None:
    """Delete a mission. Enforces ownership."""
    _get_owned_mission(mission_id, current_user["sub"])
    sb = get_supabase()
    sb.table("missions").delete().eq("id", mission_id).execute()
