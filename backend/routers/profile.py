"""Profile router — role persistence for EnPlanIt Scenario Lab.

Provides GET and PATCH endpoints for the authenticated user's profile.
Role values: 'mission_controller' | 'risk_analyst'
Role switching is allowed at any time without affecting mission data.
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from supabase_client import get_supabase
from auth0 import get_current_user

router = APIRouter()

VALID_ROLES = {"mission_controller", "risk_analyst"}


class ProfileResponse(BaseModel):
    auth0_sub: str
    email: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None    # None = not yet selected


class RoleUpdateRequest(BaseModel):
    role: str   # 'mission_controller' | 'risk_analyst'


@router.get("", response_model=ProfileResponse)
async def get_profile(
    current_user: dict = Depends(get_current_user),
) -> ProfileResponse:
    """Return the authenticated user's profile including their selected role."""
    sb = get_supabase()
    result = (
        sb.table("profiles")
        .select("auth0_sub, email, name, role")
        .eq("auth0_sub", current_user["sub"])
        .limit(1)
        .execute()
    )
    if not result.data:
        # Profile auto-created by auth0.py on first request — should always exist
        raise HTTPException(status_code=404, detail="Profile not found")
    row = result.data[0]
    return ProfileResponse(
        auth0_sub=row["auth0_sub"],
        email=row.get("email"),
        name=row.get("name"),
        role=row.get("role"),
    )


@router.patch("/role", response_model=ProfileResponse)
async def update_role(
    payload: RoleUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> ProfileResponse:
    """Switch the authenticated user's role. Never logs out or affects mission data.

    Identity is derived entirely from the verified Auth0 JWT — the frontend
    never supplies a user ID.  If the profile row doesn't exist yet (race
    condition on very first request), we create it before updating the role.
    """
    if payload.role not in VALID_ROLES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid role. Must be one of: {', '.join(sorted(VALID_ROLES))}",
        )
    sub = current_user["sub"]
    sb = get_supabase()

    # Ensure the profile exists (handles the rare race where _ensure_profile
    # hasn't run yet on this process restart)
    existing = (
        sb.table("profiles")
        .select("id")
        .eq("auth0_sub", sub)
        .limit(1)
        .execute()
    )
    if not existing.data:
        sb.table("profiles").insert({
            "auth0_sub": sub,
            "email": current_user.get("email") or None,
            "role": payload.role,
        }).execute()
    else:
        sb.table("profiles").update({"role": payload.role}).eq("auth0_sub", sub).execute()

    # Return the freshly saved profile
    result = (
        sb.table("profiles")
        .select("auth0_sub, email, name, role")
        .eq("auth0_sub", sub)
        .limit(1)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="Profile save failed unexpectedly")
    row = result.data[0]
    return ProfileResponse(
        auth0_sub=row["auth0_sub"],
        email=row.get("email"),
        name=row.get("name"),
        role=row.get("role"),
    )
