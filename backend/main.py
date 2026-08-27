"""EnPlanIt — FastAPI backend."""

import sys, os
sys.path.insert(0, os.path.dirname(__file__))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import missions, scenarios, analysis, insights, profile, documents, auth, oauth

app = FastAPI(
    title="EnPlanIt Space Intelligence API",
    version="1.0.0",
    description="Backend for the EnPlanIt space mission intelligence and scenario simulation platform.",
)

# Production & local CORS configuration
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url and frontend_url not in allowed_origins:
    allowed_origins.append(frontend_url)
if os.getenv("ALLOWED_ORIGINS"):
    allowed_origins.extend([o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()])

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https://.*\.vercel\.app" if os.getenv("ENVIRONMENT") == "production" or os.getenv("ALLOW_VERCEL_PREVIEWS", "true").lower() == "true" else None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Authentication & OAuth routes
app.include_router(auth.router,       prefix="/api/auth",       tags=["auth"])
app.include_router(oauth.router,      prefix="/api/auth/oauth", tags=["oauth"])

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
