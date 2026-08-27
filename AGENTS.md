# Agent Guidelines — EnPlanIt

Welcome to the **EnPlanIt** codebase. This repository contains a full-stack aerospace mission intelligence and scenario simulation platform built for the **IBM AI Builders Challenge (Space Exploration)**.

## Codebase Architecture
- **`frontend/`**: Next.js 14 (App Router) + TypeScript + React 19 + Vanilla CSS & Tailwind CSS.
  - `app/`: Next.js pages (`/missions/create`, `/analysis`, `/scenario-lab`, `/dashboard`, `/login`, `/signup`).
  - `components/`: UI components (OrbitalMissionMap, DocumentsPanel, FactsPanel, MissionReadiness, etc.).
  - `lib/`: API client (`api.ts`), Auth0 integration (`auth0.ts`), Role context (`RoleContext.tsx`).
- **`backend/`**: FastAPI (Python 3.11+) asynchronous microservice.
  - `main.py`: Application entry point with dynamic CORS middleware.
  - `auth0.py`: RS256 JWT validation and canonical sub resolution.
  - `granite.py`: IBM watsonx.ai Granite 3.0 inference client.
  - `ai_client.py`: Dual-pass verification pipeline.
  - `routers/`: Endpoint routers (`missions.py`, `analysis.py`, `scenarios.py`, `documents.py`, `insights.py`, `profile.py`).
- **`supabase/`**: PostgreSQL schema (`schema.sql`) and database table definitions.

## Key Development Rules
1. **Never hardcode API keys or secrets** in source code. Use environment variables.
2. **Deterministic Aerospace Equations**: All scenario simulation calculations in `scenarios.py` adhere to real physical equations (Peukert battery discharge, inverse square solar irradiance, NASA-STD-3001 consumable budgets).
3. **Type Safety**: Run `cd frontend && npx tsc --noEmit` to verify TypeScript builds before committing.
4. **Code Quality**: Keep functions modular and maintain clean documentation.
