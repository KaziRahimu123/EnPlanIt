"""EnPlanIt — FastAPI backend."""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import missions, scenarios, analysis, insights, profile, documents

app = FastAPI(
    title="EnPlanIt Space Intelligence API",
    version="1.0.0",
    description="Backend for the EnPlanIt space mission intelligence and scenario simulation platform.",
)

# ---------------------------------------------------------------------------
# Strict CORS Configuration
# ---------------------------------------------------------------------------

_default_origins = [
    "https://enplanit-web.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]

# Explicitly approved preview or custom domains via environment variables
_env_origins = []
if os.getenv("FRONTEND_URL"):
    _env_origins.append(os.getenv("FRONTEND_URL", "").strip())
if os.getenv("ALLOWED_ORIGINS"):
    _env_origins.extend(
        [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    )

# Filter and deduplicate (strictly prevent wildcards with credentials)
allowed_origins: list[str] = list(
    dict.fromkeys(
        [o for o in _default_origins + _env_origins if o and o != "*"]
    )
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

# Feature routes — authentication handled by Auth0 JWT in each router
app.include_router(missions.router,   prefix="/api/missions",   tags=["missions"])
app.include_router(scenarios.router,  prefix="/api/scenarios",  tags=["scenarios"])
app.include_router(analysis.router,   prefix="/api/analysis",   tags=["analysis"])
app.include_router(insights.router,   prefix="/api/scenarios",  tags=["insights"])
app.include_router(profile.router,    prefix="/api/profile",    tags=["profile"])
app.include_router(documents.router,  prefix="/api/missions",   tags=["documents"])


@app.get("/api/health", tags=["health"])
async def health() -> dict:
    """Basic health-check endpoint."""
    return {"status": "ok", "service": "EnPlanIt Space Intelligence API"}
