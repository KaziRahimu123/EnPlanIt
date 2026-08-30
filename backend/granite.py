"""IBM Granite via watsonx — thin client module.

All AI calls go through this module. If credentials are missing or a call
fails, the functions return a structured error dict so callers can degrade
gracefully without crashing.

Environment variables required (set in .env or shell):
  WATSONX_API_KEY    — IBM Cloud API key
  WATSONX_PROJECT_ID — watsonx project ID
  WATSONX_URL        — watsonx endpoint (default: https://us-south.ml.cloud.ibm.com)
  WATSONX_MODEL_ID   — Granite model to use   (default: ibm/granite-3-3-8b-instruct)
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

_API_KEY = (os.getenv("WATSONX_API_KEY") or os.getenv("WATSONX_APIKEY") or "").strip()
_PROJECT_ID = os.getenv("WATSONX_PROJECT_ID", "").strip()
_BASE_URL = os.getenv("WATSONX_URL", "https://us-south.ml.cloud.ibm.com").rstrip("/")
_MODEL_ID = os.getenv("WATSONX_MODEL_ID", "ibm/granite-20b-multilingual").strip()

_IAM_URL = "https://iam.cloud.ibm.com/identity/token"
_GENERATE_PATH = "/ml/v1/text/generation?version=2023-05-29"

# ---------------------------------------------------------------------------
# IAM token (cached for the process lifetime — acceptable for dev; replace
# with a refresh loop for production)
# ---------------------------------------------------------------------------

_cached_token: str | None = None


def _get_iam_token() -> str:
    """Exchange the API key for an IAM bearer token (cached)."""
    global _cached_token
    if _cached_token:
        return _cached_token
    resp = httpx.post(
        _IAM_URL,
        data={
            "grant_type": "urn:ibm:params:oauth:grant-type:apikey",
            "apikey": _API_KEY,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=15,
    )
    resp.raise_for_status()
    _cached_token = resp.json()["access_token"]
    return _cached_token


# ---------------------------------------------------------------------------
# Core generation helper
# ---------------------------------------------------------------------------

def _generate(prompt: str, max_new_tokens: int = 900) -> str:
    """Call Granite and return the generated text, or raise on failure."""
    token = _get_iam_token()
    payload = {
        "model_id": _MODEL_ID,
        "project_id": _PROJECT_ID,
        "input": prompt,
        "parameters": {
            "decoding_method": "greedy",
            "max_new_tokens": max_new_tokens,
            "repetition_penalty": 1.05,
        },
    }
    resp = httpx.post(
        f"{_BASE_URL}{_GENERATE_PATH}",
        json=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        timeout=60,
    )
    resp.raise_for_status()
    results = resp.json().get("results", [])
    if not results:
        raise ValueError("Empty results from watsonx")
    return results[0]["generated_text"].strip()


# ---------------------------------------------------------------------------
# Credential check
# ---------------------------------------------------------------------------

def credentials_configured() -> bool:
    return bool(_API_KEY and _PROJECT_ID) and not _API_KEY.startswith("YOUR_") and not _PROJECT_ID.startswith("YOUR_")



# ---------------------------------------------------------------------------
# Helper: parse a JSON block from model output
# ---------------------------------------------------------------------------

def _extract_json(text: str) -> dict[str, Any]:
    """Find the first {...} block in the text and parse it."""
    # Try to find a json code fence first
    fence = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if fence:
        return json.loads(fence.group(1))
    # Fall back to first { ... } block
    brace = re.search(r"\{.*\}", text, re.DOTALL)
    if brace:
        return json.loads(brace.group(0))
    raise ValueError("No JSON object found in model output")


# ---------------------------------------------------------------------------
# Public API — Mission Analysis
# ---------------------------------------------------------------------------

_EXTRACT_PROMPT = """\
You are a space mission planning assistant. A user has described a space mission below.

Extract the following fields from the description. For any field that is not mentioned or cannot be inferred, set the value to exactly the string "Unknown".
Never invent values. Only report what is explicitly stated or clearly implied.

Return ONLY a single valid JSON object with these exact keys:
  destination, mission_type, objective, duration, power_source, known_resources

Description:
{description}

JSON:"""

_PLAN_PROMPT = """\
You are a space mission planning assistant helping with early-phase mission design.

You have extracted the following mission parameters:
{extracted_json}

Based only on the information provided above, write a structured preliminary mission plan.
For any section where information is missing or unknown, explicitly state what is missing — do not invent values.

Return ONLY a single valid JSON object with these exact keys:
  mission_summary, objectives, required_resources, major_constraints, planning_considerations, missing_information

Each value must be a plain string (not a list). Use line breaks (\\n) to separate points within a section.

JSON:"""


def analyze_mission(description: str) -> dict[str, Any]:
    """
    Extract structured fields from a mission description, then generate a
    preliminary plan. Returns a dict with keys:
      extracted: { destination, mission_type, objective, duration,
                   power_source, known_resources }
      plan:      { mission_summary, objectives, required_resources,
                   major_constraints, planning_considerations,
                   missing_information }
      ai_available: bool
      error: str | None
    """
    if not credentials_configured():
        return _mission_unavailable("WATSONX_API_KEY or WATSONX_PROJECT_ID not configured.")

    try:
        # Step 1 — extract fields
        raw_extract = _generate(
            _EXTRACT_PROMPT.format(description=description),
            max_new_tokens=300,
        )
        extracted = _extract_json(raw_extract)

        # Step 2 — generate plan
        raw_plan = _generate(
            _PLAN_PROMPT.format(extracted_json=json.dumps(extracted, indent=2)),
            max_new_tokens=900,
        )
        plan = _extract_json(raw_plan)

        return {
            "extracted": extracted,
            "plan": plan,
            "ai_available": True,
            "error": None,
        }

    except Exception as exc:  # noqa: BLE001
        logger.warning("Granite mission analysis failed: %s", exc)
        # Reset token cache on auth failures so next request retries
        global _cached_token
        _cached_token = None
        return _mission_unavailable(str(exc))


def _mission_unavailable(reason: str) -> dict[str, Any]:
    return {
        "extracted": None,
        "plan": None,
        "ai_available": False,
        "error": reason,
    }


# ---------------------------------------------------------------------------
# Public API — Scenario AI Insights
# ---------------------------------------------------------------------------

_INSIGHTS_PROMPT = """\
You are a space mission planning assistant. A rule-based system has already calculated \
planning concern levels (LOW / MEDIUM / HIGH) for a mission scenario.

Mission context (may be partial):
{mission_context}

Variables that changed (BEFORE → AFTER):
{changes_text}

Planning concern levels — BEFORE vs AFTER:
{concerns_text}

The calculations above are final and correct. Do not recalculate or question them.
Your job is to interpret what these calculated changes mean for the mission.

Return ONLY a single valid JSON object with these exact keys:
  what_changed, why_it_matters, possible_mission_impact, what_to_investigate_next

Each value must be a plain string. Use line breaks (\\n) for multiple points.
Be specific and grounded in the numbers provided. Do not invent new concerns not reflected in the data.

JSON:"""


def scenario_insights(
    concerns_before: dict[str, dict],
    concerns_after: dict[str, dict],
    changes: list[dict],
    mission_context: str | None,
) -> dict[str, Any]:
    """
    Ask Granite to interpret already-calculated scenario results.
    Returns a dict with keys:
      insights: { what_changed, why_it_matters,
                  possible_mission_impact, what_to_investigate_next }
      ai_available: bool
      error: str | None
    """
    if not credentials_configured():
        return _insights_unavailable("WATSONX_API_KEY or WATSONX_PROJECT_ID not configured.")

    try:
        changed_vars = [c for c in changes if c.get("changed")]
        if not changed_vars:
            changes_text = "No variables were changed."
        else:
            changes_text = "\n".join(
                f"  {c['label']}: {c['before']} {c['unit']} → {c['after']} {c['unit']}"
                for c in changed_vars
            )

        concern_keys = ["power", "resources", "communication", "mission_duration"]
        concern_labels = {
            "power": "Power",
            "resources": "Resources",
            "communication": "Communication",
            "mission_duration": "Mission Duration",
        }
        concerns_text = "\n".join(
            f"  {concern_labels.get(k, k)}: {concerns_before[k]['level']} → {concerns_after[k]['level']}  "
            f"({concerns_after[k]['reason']})"
            for k in concern_keys
            if k in concerns_before and k in concerns_after
        )

        context = mission_context or "No mission description provided."

        prompt = _INSIGHTS_PROMPT.format(
            mission_context=context,
            changes_text=changes_text,
            concerns_text=concerns_text,
        )
        raw = _generate(prompt, max_new_tokens=700)
        insights = _extract_json(raw)

        return {
            "insights": insights,
            "ai_available": True,
            "error": None,
        }

    except Exception as exc:  # noqa: BLE001
        logger.warning("Granite scenario insights failed: %s", exc)
        global _cached_token
        _cached_token = None
        return _insights_unavailable(str(exc))


def _insights_unavailable(reason: str) -> dict[str, Any]:
    return {
        "insights": None,
        "ai_available": False,
        "error": reason,
    }
