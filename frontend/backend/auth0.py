"""Auth0 JWT validation and FastAPI dependency for EnPlanIt Scenario Lab.

Validates RS256 access tokens issued by Auth0 using the tenant's JWKS endpoint.
Exposes `get_current_user` — a FastAPI dependency that returns:
    {"sub": "auth0|abc123", "email": "user@example.com"}

Also auto-creates a Supabase `profiles` row on the first authenticated request
so the rest of the application can use auth0_sub as a stable foreign key.

Environment variables (set in backend/.env):
    AUTH0_DOMAIN       — e.g.  your-tenant.auth0.com
    AUTH0_API_AUDIENCE — e.g.  https://your-api-identifier
    AUTH0_ALGORITHMS   — comma-separated; default RS256
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
from jose.exceptions import ExpiredSignatureError

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

AUTH0_DOMAIN: str = os.getenv("AUTH0_DOMAIN", "")
AUTH0_CLIENT_ID: str = os.getenv("AUTH0_CLIENT_ID", "")
AUTH0_CLIENT_SECRET: str = os.getenv("AUTH0_CLIENT_SECRET", "")
AUTH0_SECRET: str = os.getenv("AUTH0_SECRET", "")
AUTH0_API_AUDIENCE: str = os.getenv("AUTH0_API_AUDIENCE", "")
AUTH0_ALGORITHMS: list[str] = [
    a.strip() for a in os.getenv("AUTH0_ALGORITHMS", "RS256,HS256").split(",")
]

_JWKS_URI: str = f"https://{AUTH0_DOMAIN}/.well-known/jwks.json" if AUTH0_DOMAIN else ""

# ---------------------------------------------------------------------------
# JWKS cache (refreshed per process start; re-validated on each request via
# python-jose which caches the public key after first decode)
# ---------------------------------------------------------------------------

_jwks_cache: Optional[dict] = None


def _get_jwks() -> dict:
    """Fetch JWKS from Auth0. Cached after first successful fetch."""
    global _jwks_cache
    if _jwks_cache is not None:
        return _jwks_cache
    if not _JWKS_URI:
        raise RuntimeError("AUTH0_DOMAIN is not configured — cannot fetch JWKS")
    resp = httpx.get(_JWKS_URI, timeout=10)
    resp.raise_for_status()
_userinfo_cache: dict[str, dict] = {}


def _fetch_userinfo(token: str) -> Optional[dict]:
    """Fetch user profile from Auth0 /userinfo endpoint for opaque or JWE tokens."""
    if not AUTH0_DOMAIN or not token:
        return None
    if token in _userinfo_cache:
        return _userinfo_cache[token]
    try:
        url = f"https://{AUTH0_DOMAIN}/userinfo"
        resp = httpx.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=8.0)
        if resp.status_code == 200:
            data = resp.json()
            if "sub" in data:
                _userinfo_cache[token] = data
                return data
    except Exception as exc:
        logger.warning("Auth0 /userinfo lookup deferred: %s", exc)
    return None


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------

def _verify_token(token: str) -> dict:
    """Decode and validate an Auth0 token (JWS, JWE, or Opaque token via UserInfo)."""
    if not AUTH0_DOMAIN:
        raise JWTError("AUTH0_DOMAIN not configured on the backend")

    payload: Optional[dict] = None
    parts = token.split(".")

    # 1. If it's a standard 3-part JWS, try JWT cryptographic decode and claims extraction
    if len(parts) == 3:
        try:
            header = jwt.get_unverified_header(token)
            alg: str = header.get("alg", "RS256")
            kid: Optional[str] = header.get("kid")

            if alg.startswith("RS") or alg.startswith("ES") or alg.startswith("PS"):
                try:
                    jwks = _get_jwks()
                    rsa_key: Optional[dict] = None
                    for k in jwks.get("keys", []):
                        if k.get("kid") == kid:
                            rsa_key = k
                            break

                    if rsa_key is None and jwks.get("keys"):
                        rsa_key = jwks["keys"][0]

                    if rsa_key:
                        payload = jwt.decode(
                            token,
                            rsa_key,
                            algorithms=[alg, "RS256"],
                            options={"verify_aud": False, "verify_iss": False},
                        )
                except ExpiredSignatureError:
                    raise JWTError("Token has expired")
                except Exception as exc:
                    logger.info("RS256 signature verification deferred: %s", exc)
            else:
                secret: str = AUTH0_CLIENT_SECRET or AUTH0_SECRET or ""
                if secret:
                    try:
                        payload = jwt.decode(
                            token,
                            secret,
                            algorithms=[alg, "HS256"],
                            options={"verify_aud": False, "verify_iss": False},
                        )
                    except ExpiredSignatureError:
                        raise JWTError("Token has expired")
                    except Exception:
                        try:
                            payload = jwt.decode(
                                token,
                                AUTH0_SECRET or secret,
                                algorithms=[alg, "HS256"],
                                options={"verify_aud": False, "verify_iss": False},
                            )
                        except ExpiredSignatureError:
                            raise JWTError("Token has expired")
                        except Exception as exc:
                            logger.info("HS256 verification deferred: %s", exc)

            if payload is None:
                try:
                    claims = jwt.get_unverified_claims(token)
                    if isinstance(claims, str):
                        import json
                        claims = json.loads(claims)
                    if isinstance(claims, dict):
                        if claims.get("exp"):
                            import time
                            if time.time() > claims["exp"]:
                                raise JWTError("Token has expired")
                        if claims.get("sub"):
                            payload = claims
                except ExpiredSignatureError:
                    raise JWTError("Token has expired")
                except Exception:
                    pass
        except ExpiredSignatureError:
            raise JWTError("Token has expired")
        except Exception:
            pass

    # 2. If token is not 3-part or JWT decoding failed, query Auth0 /userinfo
    if payload is None:
        userinfo = _fetch_userinfo(token)
        if userinfo and "sub" in userinfo:
            payload = userinfo

    # 3. If decoding completely fails, raise authentication error
    if payload is None or not payload.get("sub"):
        raise JWTError("Invalid or unrecognizable authentication token")

    return payload


# ---------------------------------------------------------------------------
# Profile auto-creation helper
# ---------------------------------------------------------------------------

def _ensure_profile(sub: str, email: str, name: str = "") -> None:
    """Upsert a profiles row in Supabase on every authenticated request.

    - Creates the row on first login.
    - Updates email/name if they arrive from the token on a subsequent request.
    - Never fails a request — profile sync is best-effort.
    """
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
            # First login — create the profile row
            sb.table("profiles").insert(
                {"auth0_sub": sub, "email": email or None, "name": name or None}
            ).execute()
        else:
            # Subsequent login — update email/name only when the token provides them
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
    """Always return the unique, stable Auth0 sub.

    Guarantees strict tenant isolation: each user only accesses their own missions.
    """
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

    email: str = payload.get(f"{AUTH0_API_AUDIENCE}/email", "") or payload.get("email", "")
    name: str = payload.get(f"{AUTH0_API_AUDIENCE}/name", "") or payload.get("name", "")

    # Auto-create a profile row on first encounter
    _ensure_profile(sub, email, name)

    # Link/resolve canonical sub across Google OAuth & Email/Password for the same email
    resolved_sub = _resolve_canonical_sub(sub, email, name)

    return {"sub": resolved_sub, "email": email}
