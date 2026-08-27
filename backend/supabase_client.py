"""Supabase client singleton for AstroOps Scenario Lab.

Usage in routers:
    from supabase_client import get_supabase
    sb = get_supabase()
    sb.table("missions").select("*").execute()

The service role key gives full access to the database and must NEVER be
exposed to the frontend.  All Supabase operations happen here, server-side.
"""

import os
from functools import lru_cache

from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

_SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
_SUPABASE_SERVICE_KEY: str = os.getenv("SUPABASE_SERVICE_KEY", "")


@lru_cache(maxsize=1)
def get_supabase() -> Client:
    """Return a cached Supabase client.  Raises on missing configuration."""
    if not _SUPABASE_URL or not _SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env"
        )
    return create_client(_SUPABASE_URL, _SUPABASE_SERVICE_KEY)
