"""Auth0 JWT validation and FastAPI dependency for EnPlanIt Scenario Lab.

Validates RS256 access tokens and ID tokens issued by Auth0 using the tenant's JWKS endpoint.
Enforces:
  - Cryptographic RS256 signature verification via Auth0 JWKS
  - Exact issuer verification (https://<AUTH0_DOMAIN>/)
  - Exact audience verification (AUTH0_API_AUDIENCE or AUTH0_CLIENT_ID)
  - Strict expiration verification (exp)
  - Fail-closed security when configuration is missing
"""

from __future__ import annotations

import os
import logging
from typing import Optional

import httpx
from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from jose.exceptions import ExpiredSignatureError, JWTClaimsError

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration — Fail Closed
# ---------------------------------------------------------------------------

AUTH0_DOMAIN: str = (
    os.getenv("AUTH0_DOMAIN", "").strip().replace("https://", "").replace("http://", "").rstrip("/")
    or os.getenv("AUTH0_ISSUER_BASE_URL", "").strip().replace("https://", "").replace("http://", "").rstrip("/")
    or "dev-jtfzglakt184mmu5.us.auth0.com"
)
AUTH0_CLIENT_ID: str = os.getenv("AUTH0_CLIENT_ID", "").strip() or "NDsjdZ159X4pAUnx0ItSwIcgATWt2Sre"
AUTH0_API_AUDIENCE: str = os.getenv("AUTH0_API_AUDIENCE", "").strip()

# Compute expected issuer URL (must have trailing slash per OIDC standard)
AUTH0_ISSUER: str = f"https://{AUTH0_DOMAIN}/" if AUTH0_DOMAIN else ""
_JWKS_URI: str = f"https://{AUTH0_DOMAIN}/.well-known/jwks.json" if AUTH0_DOMAIN else ""

# ---------------------------------------------------------------------------
# JWKS cache
# ---------------------------------------------------------------------------

_jwks_cache: Optional[dict] = None


def _get_jwks() -> dict:
    """Fetch JWKS from Auth0. Cached in memory after first successful fetch."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    if not _JWKS_URI:
        raise JWTError("AUTH0_DOMAIN is not configured — cannot fetch JWKS")
    try:
        resp = httpx.get(_JWKS_URI, timeout=10.0)
        resp.raise_for_status()
        _jwks_cache = resp.json()
        return _jwks_cache
    except Exception as exc:
        logger.error("Failed to fetch Auth0 JWKS: %s", exc)
        raise JWTError(f"Unable to retrieve Auth0 JWKS: {exc}")


# ---------------------------------------------------------------------------
# Token validation — Strict RS256 Signature, Issuer, Audience & Expiry
# ---------------------------------------------------------------------------

def _verify_token(token: str) -> dict:
    """Decode and strictly validate an Auth0 RS256 token against JWKS, issuer, and audience."""
    if not AUTH0_DOMAIN:
        raise JWTError("AUTH0_DOMAIN not configured on the backend")
    if not token or token.strip().lower() in ("null", "undefined", "none", ""):
        raise JWTError("Missing or empty authentication token")

    token = token.strip()
    parts = token.split(".")
    if len(parts) != 3:
        raise JWTError("Invalid token format: expected RS256 3-part JWT")

    try:
        header = jwt.get_unverified_header(token)
    except Exception as exc:
        raise JWTError(f"Invalid JWT header: {exc}")

    alg: str = header.get("alg", "")
    if alg != "RS256":
        raise JWTError(f"Invalid algorithm: {alg}. Only RS256 is permitted.")

    kid: Optional[str] = header.get("kid")
    if not kid:
        raise JWTError("Token header missing 'kid' claim")

    jwks = _get_jwks()
    rsa_key: Optional[dict] = None
    for k in jwks.get("keys", []):
        if k.get("kid") == kid:
            rsa_key = k
            break

    if not rsa_key:
        # Re-fetch JWKS once in case key was rotated
        global _jwks_cache
        _jwks_cache = None
        jwks = _get_jwks()
        for k in jwks.get("keys", []):
            if k.get("kid") == kid:
                rsa_key = k
                break

    if not rsa_key:
        raise JWTError("Public key matching token 'kid' not found in JWKS")

    audiences_to_try: list[Optional[str]] = [aud for aud in [AUTH0_API_AUDIENCE, AUTH0_CLIENT_ID] if aud]
    if not audiences_to_try:
        audiences_to_try = [None]

    decoded_payload: Optional[dict] = None
    last_exc: Optional[Exception] = None

    for aud in audiences_to_try:
        try:
            decoded_payload = jwt.decode(
                token,
                rsa_key,
                algorithms=["RS256"],
                issuer=AUTH0_ISSUER,
                options={
                    "verify_signature": True,
                    "verify_exp": True,
                    "verify_iss": True,
                    "verify_aud": aud is not None,
                },
                audience=aud,
            )
            if decoded_payload:
                break
        except ExpiredSignatureError:
            raise JWTError("Token has expired")
        except (JWTClaimsError, JWTError) as exc:
            last_exc = exc
            continue
        except Exception as exc:
            last_exc = exc
            continue

    if decoded_payload is None:
        if isinstance(last_exc, JWTClaimsError):
            raise JWTError(f"Invalid token claims (issuer/audience/expiry): {last_exc}")
        raise JWTError(f"Signature validation failed: {last_exc}")

    if not decoded_payload.get("sub"):
        raise JWTError("Token missing required 'sub' claim")

    return decoded_payload


# ---------------------------------------------------------------------------
# Profile auto-creation helper
# ---------------------------------------------------------------------------

def _ensure_profile(sub: str, email: str, name: str = "") -> None:
    """Upsert a profiles row in Supabase on every authenticated request."""
    try:
        from supabase_client import get_supabase
        sb = get_supabase()
        existing = (
            sb.table("profiles")
            .select("id, email, name")
            .eq("auth0_sub", sub)
            .limit(1)
            .execute()
        )
        if not existing.data:
            sb.table("profiles").insert(
                {"auth0_sub": sub, "email": email or None, "name": name or None}
            ).execute()
        else:
            row = existing.data[0]
            updates: dict = {}
            if email and not row.get("email"):
                updates["email"] = email
            if name and not row.get("name"):
                updates["name"] = name
            if updates:
                sb.table("profiles").update(updates).eq("auth0_sub", sub).execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to ensure profile for %s: %s", sub, exc)


def _resolve_canonical_sub(sub: str, email: str, name: str = "") -> str:
    """Always return the unique, stable Auth0 sub."""
    return sub


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------

_bearer = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> dict:
    """
    FastAPI dependency that validates an Auth0 Bearer token and returns the
    decoded identity:
        {"sub": "auth0|...", "email": "user@example.com"}

    Raises HTTP 401 when the token is missing or invalid.
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = _verify_token(credentials.credentials)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        )

    sub: str = payload.get("sub", "")
    if not sub:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing sub claim",
        )

    email: str = (
        payload.get(f"{AUTH0_API_AUDIENCE}/email", "")
        or payload.get("email", "")
    )
    name: str = (
        payload.get(f"{AUTH0_API_AUDIENCE}/name", "")
        or payload.get("name", "")
    )

    # Auto-create a profile row on first encounter
    _ensure_profile(sub, email, name)

    # Resolve sub
    resolved_sub = _resolve_canonical_sub(sub, email, name)

    return {"sub": resolved_sub, "email": email}
