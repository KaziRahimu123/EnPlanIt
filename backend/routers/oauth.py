"""OAuth 2.0 routes — Google and GitHub social login.

Flow (Authorization Code, no PKCE — server-side):
  1. Frontend calls GET /api/auth/oauth/{provider}?next=/dashboard
     Backend redirects the browser to the provider's authorization URL.
  2. Provider redirects back to GET /api/auth/oauth/{provider}/callback?code=…
     Backend exchanges the code for tokens, fetches user info, finds-or-creates
     an AstroOps user, issues a JWT, then redirects the browser back to the
     frontend with ?token=<jwt>&name=<name> appended to the `next` URL.
  3. Frontend's /login page (or /oauth-callback) reads the token from the URL
     and stores it in localStorage, then navigates to Dashboard.

Client secrets NEVER leave the backend.

Required env vars (set in backend/.env):
  GOOGLE_CLIENT_ID       — from Google Cloud Console
  GOOGLE_CLIENT_SECRET   — from Google Cloud Console
  GITHUB_CLIENT_ID       — from GitHub OAuth App settings
  GITHUB_CLIENT_SECRET   — from GitHub OAuth App settings
  FRONTEND_URL           — base URL of the frontend (default: http://localhost:3000)
"""

from __future__ import annotations

import os
import uuid
from datetime import datetime
from urllib.parse import urlencode, urljoin
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from database import get_db
from models import User, OAuthAccount
from auth import create_access_token

logger = logging.getLogger(__name__)
router = APIRouter()

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")

# ---------------------------------------------------------------------------
# Provider configuration
# ---------------------------------------------------------------------------

_GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID", "")
_GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
_GITHUB_CLIENT_ID     = os.getenv("GITHUB_CLIENT_ID", "")
_GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET", "")

# Callback URLs — must be registered in each provider's app settings.
# Format: {BACKEND_URL}/api/auth/oauth/{provider}/callback
# Default backend URL for local dev:
_BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")

GOOGLE_REDIRECT_URI = f"{_BACKEND_URL}/api/auth/oauth/google/callback"
GITHUB_REDIRECT_URI = f"{_BACKEND_URL}/api/auth/oauth/github/callback"

_GOOGLE_AUTH_URL  = "https://accounts.google.com/o/oauth2/v2/auth"
_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
_GOOGLE_USERINFO  = "https://www.googleapis.com/oauth2/v3/userinfo"

_GITHUB_AUTH_URL  = "https://github.com/login/oauth/authorize"
_GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
_GITHUB_USERINFO  = "https://api.github.com/user"
_GITHUB_EMAILS    = "https://api.github.com/user/emails"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _redirect_error(next_path: str, message: str) -> RedirectResponse:
    """Redirect back to the frontend login page with an error message."""
    from urllib.parse import quote
    dest = f"{FRONTEND_URL}/login?oauth_error={quote(message)}"
    return RedirectResponse(url=dest, status_code=302)


def _redirect_success(next_path: str, token: str, name: str) -> RedirectResponse:
    """Redirect to frontend with JWT token in query params."""
    from urllib.parse import quote
    safe_next = next_path.lstrip("/") if next_path else "dashboard"
    dest = f"{FRONTEND_URL}/login?token={quote(token)}&name={quote(name)}&next=/{safe_next}"
    return RedirectResponse(url=dest, status_code=302)


def _find_or_create_user(
    db: Session,
    provider: str,
    provider_user_id: str,
    email: str,
    name: str,
) -> User:
    """
    Lookup strategy (in order):
      1. Find OAuthAccount by (provider, provider_user_id) — return linked user.
      2. Find User by email — link the new OAuth account to the existing user.
      3. Create a new User + OAuthAccount.

    This means a Google sign-in with the same email as an email/password account
    will be linked to that account automatically.
    """
    # 1. Existing OAuth link
    existing_oauth = (
        db.query(OAuthAccount)
        .filter(
            OAuthAccount.provider == provider,
            OAuthAccount.provider_user_id == str(provider_user_id),
        )
        .first()
    )
    if existing_oauth:
        # Update display name in case it changed
        existing_oauth.provider_name = name
        existing_oauth.provider_email = email
        db.commit()
        return existing_oauth.user

    # 2. Existing user with same email
    user = db.query(User).filter(User.email == email.lower()).first()
    if user:
        # Link this OAuth provider to the existing account
        oauth = OAuthAccount(
            id=str(uuid.uuid4()),
            user_id=user.id,
            provider=provider,
            provider_user_id=str(provider_user_id),
            provider_name=name,
            provider_email=email,
            created_at=datetime.utcnow(),
        )
        db.add(oauth)
        db.commit()
        return user

    # 3. New user + new OAuth account
    user = User(
        id=str(uuid.uuid4()),
        name=name or email.split("@")[0],
        email=email.lower(),
        password_hash=None,  # OAuth users have no password
        created_at=datetime.utcnow(),
    )
    db.add(user)
    db.flush()  # get user.id before creating oauth record

    oauth = OAuthAccount(
        id=str(uuid.uuid4()),
        user_id=user.id,
        provider=provider,
        provider_user_id=str(provider_user_id),
        provider_name=name,
        provider_email=email,
        created_at=datetime.utcnow(),
    )
    db.add(oauth)
    db.commit()
    db.refresh(user)
    return user


# ---------------------------------------------------------------------------
# Google
# ---------------------------------------------------------------------------

@router.get("/google")
async def google_login(next: str = Query(default="/dashboard")) -> RedirectResponse:
    """Redirect the browser to Google's OAuth consent screen."""
    if not _GOOGLE_CLIENT_ID:
        return RedirectResponse(
            url=f"{FRONTEND_URL}/login?oauth_error=Google+OAuth+is+not+configured",
            status_code=302,
        )
    params = {
        "client_id":     _GOOGLE_CLIENT_ID,
        "redirect_uri":  GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope":         "openid email profile",
        "access_type":   "online",
        # Pass the intended destination through state so we can use it after callback
        "state":         next,
        "prompt":        "select_account",
    }
    url = f"{_GOOGLE_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url=url, status_code=302)


@router.get("/google/callback")
async def google_callback(
    code: str = Query(default=""),
    state: str = Query(default="/dashboard"),
    error: str = Query(default=""),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Handle Google's redirect back after the user approves the consent screen."""
    if error or not code:
        return _redirect_error(state, error or "Google login was cancelled")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Exchange code for tokens
            token_resp = await client.post(
                _GOOGLE_TOKEN_URL,
                data={
                    "code":          code,
                    "client_id":     _GOOGLE_CLIENT_ID,
                    "client_secret": _GOOGLE_CLIENT_SECRET,
                    "redirect_uri":  GOOGLE_REDIRECT_URI,
                    "grant_type":    "authorization_code",
                },
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()
            access_token = tokens.get("access_token", "")

            if not access_token:
                return _redirect_error(state, "Google did not return an access token")

            # Fetch user info
            info_resp = await client.get(
                _GOOGLE_USERINFO,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            info_resp.raise_for_status()
            info = info_resp.json()

        provider_id = info.get("sub", "")
        email       = (info.get("email") or "").lower()
        name        = info.get("name") or info.get("given_name") or email.split("@")[0]

        if not provider_id or not email:
            return _redirect_error(state, "Google did not return account information")

        user = _find_or_create_user(db, "google", provider_id, email, name)
        jwt  = create_access_token(user.id, user.email)
        return _redirect_success(state, jwt, user.name)

    except httpx.HTTPStatusError as exc:
        logger.warning("Google OAuth HTTP error: %s", exc)
        return _redirect_error(state, "Google authentication failed")
    except Exception as exc:
        logger.exception("Google OAuth unexpected error: %s", exc)
        return _redirect_error(state, "An unexpected error occurred during Google login")


# ---------------------------------------------------------------------------
# GitHub
# ---------------------------------------------------------------------------

@router.get("/github")
async def github_login(next: str = Query(default="/dashboard")) -> RedirectResponse:
    """Redirect the browser to GitHub's OAuth authorization page."""
    if not _GITHUB_CLIENT_ID:
        return RedirectResponse(
            url=f"{FRONTEND_URL}/login?oauth_error=GitHub+OAuth+is+not+configured",
            status_code=302,
        )
    params = {
        "client_id":    _GITHUB_CLIENT_ID,
        "redirect_uri": GITHUB_REDIRECT_URI,
        "scope":        "read:user user:email",
        "state":        next,
    }
    url = f"{_GITHUB_AUTH_URL}?{urlencode(params)}"
    return RedirectResponse(url=url, status_code=302)


@router.get("/github/callback")
async def github_callback(
    code: str = Query(default=""),
    state: str = Query(default="/dashboard"),
    error: str = Query(default=""),
    db: Session = Depends(get_db),
) -> RedirectResponse:
    """Handle GitHub's redirect back after the user authorizes the app."""
    if error or not code:
        return _redirect_error(state, error or "GitHub login was cancelled")

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Exchange code for access token
            token_resp = await client.post(
                _GITHUB_TOKEN_URL,
                data={
                    "client_id":     _GITHUB_CLIENT_ID,
                    "client_secret": _GITHUB_CLIENT_SECRET,
                    "code":          code,
                    "redirect_uri":  GITHUB_REDIRECT_URI,
                },
                headers={"Accept": "application/json"},
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()
            access_token = tokens.get("access_token", "")

            if not access_token:
                err_desc = tokens.get("error_description", "GitHub did not return an access token")
                return _redirect_error(state, err_desc)

            auth_header = {"Authorization": f"token {access_token}"}

            # Fetch user profile
            user_resp = await client.get(
                _GITHUB_USERINFO,
                headers={**auth_header, "Accept": "application/json"},
            )
            user_resp.raise_for_status()
            gh_user = user_resp.json()

            # GitHub may not expose email in the profile — fetch verified emails
            email = (gh_user.get("email") or "").lower()
            if not email:
                emails_resp = await client.get(
                    _GITHUB_EMAILS,
                    headers={**auth_header, "Accept": "application/json"},
                )
                if emails_resp.status_code == 200:
                    emails_data = emails_resp.json()
                    # Prefer the primary verified email
                    for e in emails_data:
                        if e.get("primary") and e.get("verified"):
                            email = e["email"].lower()
                            break
                    if not email and emails_data:
                        email = emails_data[0].get("email", "").lower()

        provider_id = str(gh_user.get("id", ""))
        name        = gh_user.get("name") or gh_user.get("login") or email.split("@")[0]

        if not provider_id:
            return _redirect_error(state, "GitHub did not return account information")

        if not email:
            # Very rare — GitHub account with no accessible email
            return _redirect_error(
                state,
                "Your GitHub account has no accessible email address. "
                "Please make your primary email public in GitHub settings and try again.",
            )

        user = _find_or_create_user(db, "github", provider_id, email, name)
        jwt  = create_access_token(user.id, user.email)
        return _redirect_success(state, jwt, user.name)

    except httpx.HTTPStatusError as exc:
        logger.warning("GitHub OAuth HTTP error: %s", exc)
        return _redirect_error(state, "GitHub authentication failed")
    except Exception as exc:
        logger.exception("GitHub OAuth unexpected error: %s", exc)
        return _redirect_error(state, "An unexpected error occurred during GitHub login")
