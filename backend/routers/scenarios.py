from __future__ import annotations

"""Scenario calculation router for AstroOps Scenario Lab.

All logic is rule-based. Thresholds are transparent and documented inline.
No AI is used here — this module produces deterministic planning concerns.

Persistence is backed by Supabase; Auth0 JWT is used for authentication.
The calculation engine (_evaluate, _power_concern, etc.) is unchanged.
"""

import re
import json
import uuid
from datetime import datetime, timezone
from typing import Optional, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from supabase_client import get_supabase
from auth0 import get_current_user
import doc_facts
import ai_client

router = APIRouter()

# ---------------------------------------------------------------------------
# Domain models
# ---------------------------------------------------------------------------

ConcernLevel = str  # "LOW" | "MEDIUM" | "HIGH" | "NOT_SPECIFIED"


class ScenarioVariables(BaseModel):
    mission_duration_days: float = Field(..., ge=0, le=36500, description="Mission duration in days (up to 100 years)")
    solar_power_pct: float = Field(..., ge=0, le=1000, description="Solar power availability %")
    battery_capacity_kwh: float = Field(..., ge=0, le=1000000, description="Battery capacity in kWh")
    daily_power_consumption_kwh: float = Field(..., ge=0, le=1000000, description="Daily power draw in kWh")
    communication_delay_min: float = Field(..., ge=0, le=100000, description="One-way comm delay in minutes")
    resource_availability_pct: float = Field(..., ge=0, le=1000, description="Resource availability %")


class ConcernResult(BaseModel):
    level: ConcernLevel
    reason: str


class CascadingEffect(BaseModel):
    source_subsystem: str
    impacted_subsystem: str
    severity: str  # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    description: str


class ReadinessDelta(BaseModel):
    score_before: int
    score_after: int
    delta: int
    status_before: str
    status_after: str
    subsystem_scores_before: dict[str, int]
    subsystem_scores_after: dict[str, int]


class SubsystemMitigation(BaseModel):
    subsystem: str
    concern_level: ConcernLevel
    recommendations: list[str]


class EnvironmentalTelemetry(BaseModel):
    destination: str
    solar_flux_w_m2: float
    solar_flux_pct_of_earth: float
    day_night_cycle_hours: float
    max_eclipse_hours: float
    crew_size: int
    daily_water_burn_kg: float
    daily_oxygen_burn_kg: float
    total_consumables_mass_kg: float
    estimated_radiation_msv: float


class ScenarioRunRequest(BaseModel):
    mission_id: str | None = None
    before: ScenarioVariables
    after: ScenarioVariables


class VariableChange(BaseModel):
    key: str
    label: str
    unit: str
    before: float
    after: float
    changed: bool


class ScenarioRunResponse(BaseModel):
    mission_id: str | None
    concerns_before: dict[str, ConcernResult]
    concerns_after: dict[str, ConcernResult]
    changes: list[VariableChange]
    cascading_effects: list[CascadingEffect] = Field(default_factory=list)
    readiness: ReadinessDelta | None = None
    mitigations: list[SubsystemMitigation] = Field(default_factory=list)
    environment: EnvironmentalTelemetry | None = None


# ---------------------------------------------------------------------------
# Threshold logic  (Deterministic aerospace engineering models)
# ---------------------------------------------------------------------------

# VARIABLE METADATA — used by VariableChange list
VARIABLE_META: list[tuple[str, str, str]] = [
    ("mission_duration_days",       "Mission Duration",           "days"),
    ("solar_power_pct",             "Solar Power Availability",   "%"),
    ("battery_capacity_kwh",        "Battery Capacity",           "kWh"),
    ("daily_power_consumption_kwh", "Daily Power Consumption",    "kWh"),
    ("communication_delay_min",     "Communication Delay",        "min"),
    ("resource_availability_pct",   "Resource Availability",      "%"),
]


def _power_concern(v: ScenarioVariables) -> ConcernResult:
    """
    Comprehensive Aerospace Electrical Power Margin Evaluation:
      - Evaluates Solar Generation Health (solar_power_pct).
      - If Battery & Daily Consumption are also provided, calculates full energy coverage ratio & autonomy.
      - If only Solar is provided, evaluates array health directly.
    """
    has_solar = v.solar_power_pct > 0
    has_battery = v.battery_capacity_kwh > 0
    has_consumption = v.daily_power_consumption_kwh > 0

    if not has_solar and not (has_battery and has_consumption):
        return ConcernResult(
            level="NOT_SPECIFIED",
            reason="No power generation architecture or battery storage telemetry specified in mission dossier.",
        )

    # 1. Solar array generation health
    solar = v.solar_power_pct if has_solar else 100.0
    if solar >= 85:
        solar_level: ConcernLevel = "LOW"
        solar_reason = f"Primary solar array operating at nominal {solar:.0f}% generation capacity."
    elif solar >= 65:
        solar_level = "MEDIUM"
        solar_reason = (
            f"Solar availability reduced to {solar:.0f}%. Atmospheric dust or high orbital inclination "
            "degrades photovoltaic output; battery reserve management and load-shedding advised."
        )
    else:
        solar_level = "HIGH"
        solar_reason = (
            f"Solar availability critically degraded at {solar:.0f}%. "
            "Insufficient primary generation capacity — high electrical brownout hazard."
        )

    # 2. If storage and consumption are also provided, evaluate full power coverage ratio
    if has_battery and has_consumption:
        effective = (solar / 100.0) * v.battery_capacity_kwh
        consumption = v.daily_power_consumption_kwh
        battery = v.battery_capacity_kwh
        ratio = effective / max(0.1, consumption)
        buffer_hours = (battery / max(0.1, consumption)) * 24.0

        if ratio >= 1.30 and solar >= 85:
            return ConcernResult(
                level="LOW",
                reason=(
                    f"Supply: {effective:.1f} kWh/day (at {solar:.0f}% solar) vs Demand: {consumption:.1f} kWh/day "
                    f"({ratio:.2f}x generation coverage). Battery storage ({battery:.1f} kWh) provides "
                    f"{buffer_hours:.1f}h continuous energy autonomy."
                ),
            )
        elif ratio >= 0.95 and solar >= 65:
            return ConcernResult(
                level="MEDIUM",
                reason=(
                    f"Supply: {effective:.1f} kWh/day (at {solar:.0f}% solar) vs Demand: {consumption:.1f} kWh/day "
                    f"({ratio:.2f}x coverage). Battery buffer ({battery:.1f} kWh / {buffer_hours:.1f}h autonomy) "
                    "requires load-shedding during low insolation."
                ),
            )
        else:
            return ConcernResult(
                level="HIGH",
                reason=(
                    f"Supply: {effective:.1f} kWh/day vs Demand: {consumption:.1f} kWh/day "
                    f"(Deficit: {ratio*100:.0f}% coverage). Battery capacity ({battery:.1f} kWh) will deplete in "
                    f"{buffer_hours:.1f}h without auxiliary generation."
                ),
            )

    # If only solar was provided, return the solar array health evaluation
    return ConcernResult(level=solar_level, reason=solar_reason)


def _resource_concern(v: ScenarioVariables) -> ConcernResult:
    """
    Comprehensive Life Support (ECLSS) Consumables Evaluation:
      - Computes daily water (10.0 kg/d) & oxygen (3.36 kg/d) baseline for standard 4-crew complement.
      - Calculates closed-loop recycling reserve buffer and mission sustainability.
    """
    pct = v.resource_availability_pct
    daily_h2o = 10.0
    daily_o2 = 3.36

    if pct <= 0:
        return ConcernResult(
            level="NOT_SPECIFIED",
            reason="No life-support (ECLSS) or consumables buffer telemetry specified in mission dossier.",
        )
    elif pct >= 85:
        return ConcernResult(
            level="LOW",
            reason=(
                f"ECLSS capacity at {pct:.0f}%. Nominal consumption: {daily_h2o:.1f} kg H₂O/day & "
                f"{daily_o2:.2f} kg O₂/day (crew of 4). Closed-loop reclamation provides robust contingency buffer."
            ),
        )
    elif pct >= 60:
        return ConcernResult(
            level="MEDIUM",
            reason=(
                f"ECLSS capacity at {pct:.0f}%. Consumable burn: {daily_h2o:.1f} kg H₂O/day & {daily_o2:.2f} kg O₂/day. "
                "Closed-loop recovery efficiency must maintain >=90% to avoid premature consumable exhaustion."
            ),
        )
    else:
        return ConcernResult(
            level="HIGH",
            reason=(
                f"ECLSS capacity critical at {pct:.0f}%. High consumable depletion hazard "
                f"({daily_h2o:.1f} kg H₂O/day, {daily_o2:.2f} kg O₂/day). Mandatory rationing and emergency resupply window required."
            ),
        )


def _communication_concern(v: ScenarioVariables) -> ConcernResult:
    """
    Comprehensive Planetary Link Latency Evaluation:
      - Computes Speed-of-Light 1-Way Latency & Round-Trip Time (RTT).
      - Determines Ground Command & Control Loop Window and required Onboard Autonomy Level.
    """
    delay = v.communication_delay_min
    if delay <= 0:
        return ConcernResult(
            level="NOT_SPECIFIED",
            reason="Communication delay and ground telemetry link parameters are unspecified in mission dossier.",
        )

    rtt = delay * 2.0
    if delay <= 3.0:
        return ConcernResult(
            level="LOW",
            reason=(
                f"Signal latency: {delay:.1f} min 1-way ({rtt:.1f} min RTT). "
                "Near-Earth/Cislunar link enables real-time flight telemetry and ground abort commanding."
            ),
        )
    elif delay <= 15.0:
        return ConcernResult(
            level="MEDIUM",
            reason=(
                f"Signal latency: {delay:.1f} min 1-way ({rtt:.1f} min RTT). "
                "Turnaround window precludes real-time emergency intervention; Level-3 tactical crew autonomy enabled."
            ),
        )
    else:
        return ConcernResult(
            level="HIGH",
            reason=(
                f"Signal latency: {delay:.1f} min 1-way ({rtt:.1f} min RTT). "
                "Deep-space distance creates communications blackout for emergency ground response; Level-4 flight autonomy mandatory."
            ),
        )


def _duration_concern(v: ScenarioVariables) -> ConcernResult:
    """
    Comprehensive Mission Duration & Cosmic Radiation Exposure Evaluation:
      - Computes Cumulative Ionizing Radiation Dose (mSv) = Days * 0.70 mSv/day.
      - Calculates % of NASA / ESA Lifetime Career Radiation Safety Limit (600 mSv).
      - Computes Total Consumables Mass Logistics Budget (kg) = Days * 19.2 kg/day (4 crew).
    """
    days = v.mission_duration_days
    if days <= 0:
        return ConcernResult(
            level="NOT_SPECIFIED",
            reason="Mission timeline duration is unspecified in mission dossier.",
        )

    radiation_msv = round(days * 0.70, 1)
    career_limit_pct = round((radiation_msv / 600.0) * 100.0, 1)
    consumables_mass_kg = round(days * 19.2, 1)

    if days <= 60:
        return ConcernResult(
            level="LOW",
            reason=(
                f"Mission span: {days:.0f} days. Estimated cumulative radiation: {radiation_msv:.1f} mSv "
                f"({career_limit_pct:.1f}% of NASA 600 mSv career limit). Consumables payload mass: {consumables_mass_kg:,.0f} kg (NASA-STD-3001 4-crew baseline: 19.2 kg/day)."
            ),
        )
    elif days <= 270:
        return ConcernResult(
            level="MEDIUM",
            reason=(
                f"Mission span: {days:.0f} days. Estimated cumulative radiation: {radiation_msv:.1f} mSv "
                f"({career_limit_pct:.1f}% of NASA 600 mSv career limit). Consumables budget: {consumables_mass_kg:,.0f} kg (NASA-STD-3001 4-crew baseline: 19.2 kg/day). "
                "Requires active bio-monitoring and musculoskeletal exercise protocols."
            ),
        )
    else:
        return ConcernResult(
            level="HIGH",
            reason=(
                f"Mission span: {days:.0f} days. Estimated cumulative radiation: {radiation_msv:.1f} mSv "
                f"({career_limit_pct:.1f}% of NASA 600 mSv career limit). Consumables logistics mass: {consumables_mass_kg:,.0f} kg (NASA-STD-3001 4-crew baseline: 19.2 kg/day). "
                "Severe chronic GCR/SPE exposure risk; engineered regolith storm shelter mandatory."
            ),
        )


def _evaluate(v: ScenarioVariables) -> dict[str, ConcernResult]:
    return {
        "power": _power_concern(v),
        "resources": _resource_concern(v),
        "communication": _communication_concern(v),
        "mission_duration": _duration_concern(v),
    }


def _build_changes(before: ScenarioVariables, after: ScenarioVariables) -> list[VariableChange]:
    changes = []
    for key, label, unit in VARIABLE_META:
        b = getattr(before, key)
        a = getattr(after, key)
        changes.append(
            VariableChange(key=key, label=label, unit=unit, before=b, after=a, changed=(b != a))
        )
    return changes


# ---------------------------------------------------------------------------
# Supabase persistence helpers
# ---------------------------------------------------------------------------

def _save_scenario(
    mission_id: str,
    auth0_sub: str,
    before: ScenarioVariables,
    after: ScenarioVariables,
    concerns_before: dict,
    concerns_after: dict,
    changes: list,
) -> None:
    """Upsert scenario results for a mission. Silently skips on ownership mismatch."""
    try:
        sb = get_supabase()
        # Verify ownership — .limit(1).execute() always returns APIResponse(.data=[...]),
        # unlike .maybe_single().execute() which returns None on zero rows (supabase-py 2.x).
        mission = (
            sb.table("missions")
            .select("id")
            .eq("id", mission_id)
            .eq("auth0_sub", auth0_sub)
            .limit(1)
            .execute()
        )
        if not mission.data:
            return

        now = datetime.now(timezone.utc).isoformat()
        data = {
            "mission_id": mission_id,
            "auth0_sub": auth0_sub,
            "before_vars": before.model_dump(),
            "after_vars": after.model_dump(),
            "concerns_before": {k: v.model_dump() for k, v in concerns_before.items()},
            "concerns_after": {k: v.model_dump() for k, v in concerns_after.items()},
            "changes": [c.model_dump() for c in changes],
            "updated_at": now,
        }

        existing = (
            sb.table("scenario_runs")
            .select("id")
            .eq("mission_id", mission_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            sb.table("scenario_runs").update(data).eq("mission_id", mission_id).execute()
        else:
            sb.table("scenario_runs").insert(data).execute()

        # bump mission updated_at
        sb.table("missions").update({"updated_at": now}).eq("id", mission_id).execute()
    except Exception:  # noqa: BLE001
        pass


def _save_scenario_insights(
    mission_id: str,
    auth0_sub: str,
    insights: Optional[dict],
) -> None:
    """Persist AI insights onto the existing scenario result row."""
    if not insights:
        return
    try:
        sb = get_supabase()
        mission = (
            sb.table("missions")
            .select("id")
            .eq("id", mission_id)
            .eq("auth0_sub", auth0_sub)
            .limit(1)
            .execute()
        )
        if not mission.data:
            return
        sb.table("scenario_runs").update({"insights": insights}).eq("mission_id", mission_id).execute()
    except Exception:  # noqa: BLE001
        pass


def _build_full_scenario_response(mission_id: str | None, before: ScenarioVariables, after: ScenarioVariables) -> ScenarioRunResponse:
    concerns_before = _evaluate(before)
    concerns_after = _evaluate(after)
    changes = _build_changes(before, after)

    # 1. Fetch mission destination & crew if available
    destination = "Mars Surface"
    crew_size = 4
    if mission_id:
        try:
            sb = get_supabase()
            m_res = sb.table("missions").select("destination, description").eq("id", mission_id).limit(1).execute()
            if m_res.data:
                destination = m_res.data[0].get("destination") or "Mars Surface"
                desc = (m_res.data[0].get("description") or "").lower()
                c_match = re.search(r"crew\s*(?:of)?\s*(\d+)", desc)
                if c_match:
                    crew_size = int(c_match.group(1))
        except Exception:
            pass

    # 2. Environmental Telemetry
    dest_lower = destination.lower()
    if "mars" in dest_lower:
        solar_flux = 590.0
        flux_pct = 43.4
        day_night_h = 24.6
        max_eclipse_h = 12.3
    elif "moon" in dest_lower or "lunar" in dest_lower:
        solar_flux = 1361.0
        flux_pct = 100.0
        day_night_h = 708.0
        max_eclipse_h = 354.0  # 14.75 days of darkness
    elif "leo" in dest_lower or "earth" in dest_lower:
        solar_flux = 1361.0
        flux_pct = 100.0
        day_night_h = 1.5
        max_eclipse_h = 0.6
    else:
        solar_flux = 590.0
        flux_pct = 43.4
        day_night_h = 24.6
        max_eclipse_h = 12.3

    daily_water = crew_size * 2.5
    daily_o2 = crew_size * 0.84
    daily_food = crew_size * 1.8
    total_consumables_kg = round(after.mission_duration_days * (daily_water + daily_o2 + daily_food), 1)
    radiation_msv = round(after.mission_duration_days * (0.7 if "surface" in dest_lower else 1.2), 1)

    environment = EnvironmentalTelemetry(
        destination=destination,
        solar_flux_w_m2=solar_flux,
        solar_flux_pct_of_earth=flux_pct,
        day_night_cycle_hours=day_night_h,
        max_eclipse_hours=max_eclipse_h,
        crew_size=crew_size,
        daily_water_burn_kg=round(daily_water, 2),
        daily_oxygen_burn_kg=round(daily_o2, 2),
        total_consumables_mass_kg=total_consumables_kg,
        estimated_radiation_msv=radiation_msv,
    )

    # 3. Cascading Effects (Only for specified telemetry with real variance/constraints)
    cascades: list[CascadingEffect] = []

    # Cascade 1: Solar power degradation -> ECLSS Oxygen & Water synthesis
    if after.solar_power_pct > 0 and (after.solar_power_pct < 65 or (before.solar_power_pct > 0 and after.solar_power_pct < before.solar_power_pct and after.solar_power_pct < 85)):
        drop_pct = round(100.0 - after.solar_power_pct)
        cascades.append(CascadingEffect(
            source_subsystem="Power Subsystem",
            impacted_subsystem="ECLSS & ISRU Production",
            severity="CRITICAL" if after.solar_power_pct < 50 else "HIGH",
            description=f"Reduced solar availability ({after.solar_power_pct:.0f}%) forces electrical load-shedding on life-support processors, reducing O2/H2O synthesis rate by ~{drop_pct}%.",
        ))

    # Cascade 2: Duration extension -> Cumulative Radiation Dose & Resupply Budget
    if after.mission_duration_days > 270:
        cascades.append(CascadingEffect(
            source_subsystem="Mission Timeline",
            impacted_subsystem="Crew Health & Bio-Shielding",
            severity="CRITICAL" if radiation_msv > 600 else "HIGH",
            description=f"Mission duration ({after.mission_duration_days:.0f}d) pushes cumulative radiation exposure to {radiation_msv:.0f} mSv{' (exceeds NASA career limits without regolith shielding)' if radiation_msv > 600 else ''} and requires {total_consumables_kg:,.0f} kg total life-support consumables (NASA-STD-3001 baseline: 19.2 kg/day for 4 crew).",
        ))

    # Cascade 3: Communication Delay -> Autonomous Flight Safety
    if after.communication_delay_min > 3.0:
        roundtrip = after.communication_delay_min * 2
        cascades.append(CascadingEffect(
            source_subsystem="Communications",
            impacted_subsystem="Flight Operations & Safing",
            severity="HIGH" if after.communication_delay_min > 15.0 else "MEDIUM",
            description=f"Speed-of-light delay ({after.communication_delay_min:.1f}m one-way, {roundtrip:.1f}m round-trip) precludes real-time ground control intervention during flight anomalies; Level-4 onboard autonomy is required.",
        ))

    # Cascade 4: Solar Eclipse / Night Energy Deficit
    if after.daily_power_consumption_kwh > 0 and after.battery_capacity_kwh > 0 and max_eclipse_h > 20:
        eclipse_energy_req = (after.daily_power_consumption_kwh / 24.0) * max_eclipse_h
        if after.battery_capacity_kwh < eclipse_energy_req:
            cascades.append(CascadingEffect(
                source_subsystem="Electrical Energy Storage",
                impacted_subsystem="Thermal & Habitat Life Support",
                severity="CRITICAL",
                description=f"{destination} eclipse cycle requires {eclipse_energy_req:.1f} kWh of continuous survival power, but installed battery capacity is only {after.battery_capacity_kwh:.1f} kWh. Habitat blackout will occur without nuclear surface power.",
            ))

    # 4. Readiness Scores (Before vs After)
    def compute_subsystem_readiness(v: ScenarioVariables) -> dict[str, int]:
        has_solar = v.solar_power_pct > 0
        has_battery = v.battery_capacity_kwh > 0
        has_consumption = v.daily_power_consumption_kwh > 0
        is_power_unspecified = not has_solar and not (has_battery and has_consumption)

        is_eclss_unspecified = v.resource_availability_pct <= 0
        is_comm_unspecified = v.communication_delay_min <= 0
        is_dur_unspecified = v.mission_duration_days <= 0

        if is_power_unspecified:
            p_score = 0
        elif has_battery and has_consumption:
            eff_ratio = ((v.solar_power_pct / 100.0) * v.battery_capacity_kwh) / max(0.1, v.daily_power_consumption_kwh)
            p_score = min(100, max(10, int(min(1.3, eff_ratio) / 1.3 * 60 + (v.solar_power_pct / 100.0) * 40)))
        else:
            p_score = min(100, max(10, int(v.solar_power_pct)))

        e_score = 0 if is_eclss_unspecified else min(100, max(10, int(v.resource_availability_pct * 0.7 + (100 if v.mission_duration_days <= 270 else max(20, 100 - (v.mission_duration_days - 270) * 0.15)) * 0.3)))
        c_score = 0 if is_comm_unspecified else min(100, max(15, int(100 - min(85, v.communication_delay_min * 2.5))))
        d_score = 0 if is_dur_unspecified else min(100, max(15, int(100 if v.mission_duration_days <= 60 else (80 if v.mission_duration_days <= 270 else max(20, 80 - (v.mission_duration_days - 270) * 0.1)))))
        return {
            "Power": p_score,
            "Life Support (ECLSS)": e_score,
            "Communications": c_score,
            "Crew Bio-Safety": d_score,
        }

    sub_b = compute_subsystem_readiness(before)
    sub_a = compute_subsystem_readiness(after)

    valid_b = [s for s in sub_b.values() if s > 0]
    valid_a = [s for s in sub_a.values() if s > 0]

    score_b = round(sum(valid_b) / len(valid_b)) if valid_b else 0
    score_a = round(sum(valid_a) / len(valid_a)) if valid_a else 0
    delta = score_a - score_b

    def status_label(s: int) -> str:
        if s <= 0: return "UNSPECIFIED"
        if s >= 85: return "FLIGHT READY"
        if s >= 70: return "MODERATE READINESS"
        if s >= 50: return "CONSTRAINED"
        return "CRITICAL RISK"

    readiness = ReadinessDelta(
        score_before=score_b,
        score_after=score_a,
        delta=delta,
        status_before=status_label(score_b),
        status_after=status_label(score_a),
        subsystem_scores_before=sub_b,
        subsystem_scores_after=sub_a,
    )

    # 5. Aerospace Engineering Mitigations (Only for active evaluated concerns)
    mitigations: list[SubsystemMitigation] = []
    for sub_name, c_res in concerns_after.items():
        if c_res.level in ("MEDIUM", "HIGH"):
            recs: list[str] = []
            if sub_name == "power" and after.daily_power_consumption_kwh > 0:
                recs.append("Deploy a Kilopower Fission Surface Reactor (FSP) or fuel cell buffer for continuous baseload power.")
                recs.append("Automate dynamic load-shedding of non-critical science instruments during low-generation windows.")
            elif sub_name == "resources" and after.resource_availability_pct > 0:
                recs.append("Upgrade closed-loop Vapor Compression Distillation (VCD) urine water recycling to 98% recovery.")
                recs.append("Pre-deploy robotic un-crewed cryogenic LOX/CH4 storage depot before crew arrival.")
            elif sub_name == "communication" and after.communication_delay_min > 0:
                recs.append("Deploy high-bandwidth Deep Space Optical Communications (DSOC) laser relay in orbit.")
                recs.append("Implement onboard edge AI for autonomous telemetry health monitoring and Level-4 anomaly recovery.")
            elif sub_name == "mission_duration" and after.mission_duration_days > 0:
                recs.append("Construct a 50 cm sintered regolith habitat berm for solar particle event (SPE) and cosmic ray shielding.")
                recs.append("Implement rotational crew exercise protocols (ARED/T2) and artificial gravity countermeasure studies.")

            if recs:
                mitigations.append(SubsystemMitigation(
                    subsystem=sub_name.replace("_", " ").title(),
                    concern_level=c_res.level,
                    recommendations=recs,
                ))

    return ScenarioRunResponse(
        mission_id=mission_id,
        concerns_before=concerns_before,
        concerns_after=concerns_after,
        changes=changes,
        cascading_effects=cascades,
        readiness=readiness,
        mitigations=mitigations,
        environment=environment,
    )


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/run", response_model=ScenarioRunResponse)
async def run_scenario(payload: ScenarioRunRequest) -> ScenarioRunResponse:
    """
    Evaluate planning concerns, cascading impacts, readiness delta, and mitigations.
    """
    return _build_full_scenario_response(payload.mission_id, payload.before, payload.after)


@router.post("/run/save", response_model=ScenarioRunResponse)
async def run_scenario_and_save(
    payload: ScenarioRunRequest,
    current_user: dict = Depends(get_current_user),
) -> ScenarioRunResponse:
    """
    Run scenario AND persist results to Supabase. Requires authentication.
    """
    resp = _build_full_scenario_response(payload.mission_id, payload.before, payload.after)

    if payload.mission_id:
        _save_scenario(
            payload.mission_id,
            current_user["sub"],
            payload.before,
            payload.after,
            resp.concerns_before,
            resp.concerns_after,
            resp.changes,
        )

    return resp


class ScenarioInsightsRequest(BaseModel):
    mission_id: Optional[str] = None
    mission_context: Optional[str] = None
    concerns_before: dict[str, Any]
    concerns_after: dict[str, Any]
    changes: list[dict[str, Any]]


class ScenarioInsightsResponse(BaseModel):
    mission_id: Optional[str] = None
    insights: Optional[dict[str, Any]] = None
    ai_available: bool = True
    error: Optional[str] = None


@router.post("/insights", response_model=ScenarioInsightsResponse)
async def get_insights(payload: ScenarioInsightsRequest) -> ScenarioInsightsResponse:
    """
    Generate dynamic AI scenario trade-off insights using GPT-5.6 Luna.
    """
    res = ai_client.generate_scenario_insights(
        concerns_before=payload.concerns_before,
        concerns_after=payload.concerns_after,
        changes=payload.changes,
        mission_context=payload.mission_context,
    )
    return ScenarioInsightsResponse(
        mission_id=payload.mission_id,
        insights=res.get("insights"),
        ai_available=res.get("ai_available", True),
        error=res.get("error"),
    )


@router.post("/insights/save", response_model=ScenarioInsightsResponse)
async def get_insights_and_save(
    payload: ScenarioInsightsRequest,
    current_user: dict = Depends(get_current_user),
) -> ScenarioInsightsResponse:
    """
    Generate dynamic AI scenario insights AND save onto the existing scenario run row in Supabase.
    """
    res = ai_client.generate_scenario_insights(
        concerns_before=payload.concerns_before,
        concerns_after=payload.concerns_after,
        changes=payload.changes,
        mission_context=payload.mission_context,
    )
    if payload.mission_id and res.get("insights"):
        _save_scenario_insights(payload.mission_id, current_user["sub"], res["insights"])

    return ScenarioInsightsResponse(
        mission_id=payload.mission_id,
        insights=res.get("insights"),
        ai_available=res.get("ai_available", True),
        error=res.get("error"),
    )


# ---------------------------------------------------------------------------
# Scenario load endpoint
# ---------------------------------------------------------------------------

class SavedScenarioResponse(BaseModel):
    mission_id: str
    before_vars: Optional[dict] = None
    after_vars: Optional[dict] = None
    concerns_before: Optional[dict] = None
    concerns_after: Optional[dict] = None
    changes: Optional[list] = None
    insights: Optional[dict] = None
    updated_at: Optional[str] = None


@router.get("/saved/{mission_id}", response_model=SavedScenarioResponse)
async def get_saved_scenario(
    mission_id: str,
    current_user: dict = Depends(get_current_user),
) -> SavedScenarioResponse:
    """Return saved scenario data for a mission. Enforces ownership."""
    sb = get_supabase()
    mission = (
        sb.table("missions")
        .select("id")
        .eq("id", mission_id)
        .eq("auth0_sub", current_user["sub"])
        .limit(1)
        .execute()
    )
    if not mission.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    scenario = (
        sb.table("scenario_runs")
        .select("*")
        .eq("mission_id", mission_id)
        .limit(1)
        .execute()
    )
    if not scenario.data:
        return SavedScenarioResponse(mission_id=mission_id)

    row = scenario.data[0]
    return SavedScenarioResponse(
        mission_id=mission_id,
        before_vars=row.get("before_vars"),
        after_vars=row.get("after_vars"),
        concerns_before=row.get("concerns_before"),
        concerns_after=row.get("concerns_after"),
        changes=row.get("changes"),
        insights=row.get("insights"),
        updated_at=row.get("updated_at"),
    )


# ---------------------------------------------------------------------------
# Scenario BEFORE values — derived from mission facts (document extraction)
# ---------------------------------------------------------------------------

class BeforeValueInfo(BaseModel):
    key: str
    label: str
    unit: str
    value: Optional[float]          # None = NOT PROVIDED
    state: str                      # 'confirmed' | 'extracted' | 'not_specified' | 'default'
    source_label: Optional[str]     # human label for the source
    source_text: Optional[str]      # verbatim quote


class MissionBeforeValuesResponse(BaseModel):
    mission_id: str
    values: list[BeforeValueInfo]
    has_document_data: bool
    is_aerospace_mission: bool = True
    non_aerospace_warning: Optional[str] = None


def parse_duration_to_days(val: Optional[str]) -> Optional[float]:
    if not val:
        return None
    val_lower = str(val).lower().strip()
    # Check for explicit duration phrasing first
    match = re.search(r"(?:operational\s+timeline|mission\s+duration|duration|planned\s+for|stay|habitation|span|lasting)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*(?:to|-|and)?\s*(\d+(?:\.\d+)?)?\s*(months?|mos?|years?|yrs?|days?|d|weeks?|wks?|sols?)\b", val_lower)
    if not match:
        # If the string itself is just a short duration like "540 days" or "1.5 years"
        match = re.match(r"^(\d+(?:\.\d+)?)\s*(months?|mos?|years?|yrs?|days?|d|weeks?|wks?|sols?)$", val_lower)
    if not match:
        return None
    v1 = float(match.group(1))
    v2 = float(match.group(2)) if len(match.groups()) >= 2 and match.group(2) and match.group(2).replace('.', '', 1).isdigit() else None
    unit = match.group(3).lower() if len(match.groups()) >= 3 and match.group(3) else (match.group(2).lower() if len(match.groups()) >= 2 and match.group(2) else "day")
    num = (v1 + v2) / 2.0 if v2 else v1
    if "year" in unit or "yr" in unit:
        return round(num * 365.0, 1)
    elif "month" in unit or "mo" in unit:
        return round(num * 30.0, 1)
    elif "week" in unit or "w" in unit:
        return round(num * 7.0, 1)
    elif "sol" in unit:
        return round(num * 1.027, 1)
    return round(num, 1)


@router.get("/before-values/{mission_id}", response_model=MissionBeforeValuesResponse)
async def get_before_values(
    mission_id: str,
    current_user: dict = Depends(get_current_user),
) -> MissionBeforeValuesResponse:
    """
    Return BEFORE values for the Scenario Lab, derived from mission facts and extracted metadata.
    """
    sb = get_supabase()
    # Ownership check & load all mission extraction fields
    mission_res = (
        sb.table("missions")
        .select("id, duration, destination, power_source, known_resources, description, mission_type")
        .eq("id", mission_id)
        .eq("auth0_sub", current_user["sub"])
        .limit(1)
        .execute()
    )
    if not mission_res.data:
        raise HTTPException(status_code=404, detail="Mission not found")

    m = mission_res.data[0]

    # Fetch document facts for this mission
    facts_res = (
        sb.table("document_facts")
        .select("field_key, label, numeric_value, unit, state, source_text")
        .eq("mission_id", mission_id)
        .neq("state", "not_specified")
        .execute()
    )
    # Build a lookup: field_key -> best fact (prefer confirmed > extracted > needs_review)
    _rank = {"confirmed": 3, "extracted": 2, "needs_review": 1}
    facts_by_key: dict[str, dict] = {}
    for f in (facts_res.data or []):
        key = f["field_key"]
        current_rank = _rank.get(facts_by_key.get(key, {}).get("state", ""), 0)
        new_rank = _rank.get(f.get("state", ""), 0)
        if new_rank > current_rank:
            facts_by_key[key] = f

    desc_raw = m.get("description") or ""
    is_aerospace = doc_facts.is_aerospace_mission_text(desc_raw)
    has_doc_data = bool(facts_by_key) or (is_aerospace and bool(m.get("duration") or m.get("power_source") or m.get("known_resources")))
    values: list[BeforeValueInfo] = []

    for key, label, unit in VARIABLE_META:
        if key in facts_by_key:
            f = facts_by_key[key]
            values.append(BeforeValueInfo(
                key=key, label=label, unit=unit,
                value=f.get("numeric_value"),
                state=f.get("state", "extracted"),
                source_label="Document Fact",
                source_text=f.get("source_text"),
            ))
        elif key == "mission_duration_days":
            dur_days = (parse_duration_to_days(m.get("duration")) or parse_duration_to_days(m.get("description"))) if is_aerospace else None
            if dur_days is not None:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=dur_days,
                    state="extracted",
                    source_label=f"Mission Profile ({m.get('duration') or str(dur_days) + 'd'})",
                    source_text=m.get("duration") or m.get("description"),
                ))
            else:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=None,
                    state="not_specified",
                    source_label=None,
                    source_text="Document is unrelated to space mission operations." if not is_aerospace else "Not specified in mission dossier or description.",
                ))
        elif key == "solar_power_pct":
            p_src = (m.get("power_source") or "").lower()
            desc = desc_raw.lower()
            if is_aerospace and ("solar" in p_src or "pv" in p_src) and p_src != "unknown":
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=100.0,
                    state="extracted",
                    source_label="Mission Profile (Solar)",
                    source_text=m.get("power_source"),
                ))
            else:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=None,
                    state="not_specified",
                    source_label=None,
                    source_text="Document is unrelated to space mission operations." if not is_aerospace else "Not specified in mission dossier or description.",
                ))
        elif key == "resource_availability_pct":
            res_txt = (m.get("known_resources") or "")
            is_valid_res = (res_txt and res_txt.lower() != "unknown" and res_txt.strip() != "[]")
            if is_aerospace and is_valid_res:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=100.0,
                    state="extracted",
                    source_label="Mission Profile (Resources)",
                    source_text=m.get("known_resources"),
                ))
            else:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=None,
                    state="not_specified",
                    source_label=None,
                    source_text="Document is unrelated to space mission operations." if not is_aerospace else "Not specified in mission dossier or description.",
                ))
        elif key == "communication_delay_min":
            desc = desc_raw.lower()
            comm_match_1 = re.search(r"(?:one-way\s+)?(?:communication\s+)?(?:delay|latency|lag|comm\s+delay|signal\s+delay)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*[\-\s]*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?)", desc)
            comm_match_2 = re.search(r"(\d+(?:\.\d+)?)\s*[\-\s]*(?:minutes?|mins?|seconds?|secs?|hours?|hrs?)\s*(?:[a-z\-]+\s+){0,3}(?:delay|latency|lag|comm)", desc)
            comm_match = (comm_match_1 or comm_match_2) if is_aerospace else None
            if comm_match:
                delay_val = float(comm_match.group(1))
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=delay_val,
                    state="extracted",
                    source_label="Description (Comm Delay)",
                    source_text=comm_match.group(0),
                ))
            else:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=None,
                    state="not_specified",
                    source_label=None,
                    source_text="Document is unrelated to space mission operations." if not is_aerospace else "Not specified in mission dossier or description.",
                ))
        elif key == "battery_capacity_kwh":
            desc = desc_raw.lower()
            bat_match_1 = re.search(r"(\d+(?:\.\d+)?)\s*kwh\s*(?:[a-z\-]+\s+){0,3}(?:battery|storage|reserve|bank)", desc)
            bat_match_2 = re.search(r"(?:battery|storage|energy storage|reserve)\s*(?:capacity|bank|system|reserve|size)?\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*kwh", desc)
            bat_match = (bat_match_1 or bat_match_2) if is_aerospace else None
            if bat_match:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=float(bat_match.group(1)),
                    state="extracted",
                    source_label="Description (Battery)",
                    source_text=bat_match.group(0),
                ))
            else:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=None,
                    state="not_specified",
                    source_label=None,
                    source_text="Document is unrelated to space mission operations." if not is_aerospace else "Not specified in mission dossier or description.",
                ))
        elif key == "daily_power_consumption_kwh":
            desc = desc_raw.lower()
            pow_match_1 = re.search(r"(?:daily\s*(?:station\s*)?power\s*consumption|daily\s*draw|consumption|power\s*consumption|daily\s*station\s*load|power\s*demand)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*kwh", desc)
            pow_match_2 = re.search(r"(\d+(?:\.\d+)?)\s*kwh\s*(?:per\s*(?:sol|day)|daily\s*(?:power\s*)?consumption|daily\s*draw)", desc)
            pow_match = (pow_match_1 or pow_match_2) if is_aerospace else None
            if pow_match:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=float(pow_match.group(1)),
                    state="extracted",
                    source_label="Description (Power Consumption)",
                    source_text=pow_match.group(0),
                ))
            else:
                values.append(BeforeValueInfo(
                    key=key, label=label, unit=unit,
                    value=None,
                    state="not_specified",
                    source_label=None,
                    source_text="Document is unrelated to space mission operations." if not is_aerospace else "Not specified in mission dossier or description.",
                ))
        else:
            values.append(BeforeValueInfo(
                key=key, label=label, unit=unit,
                value=None,
                state="not_specified",
                source_label=None,
                source_text="Document is unrelated to space mission operations." if not is_aerospace else None,
            ))

    return MissionBeforeValuesResponse(
        mission_id=mission_id,
        values=values,
        has_document_data=has_doc_data,
        is_aerospace_mission=is_aerospace,
        non_aerospace_warning=None if is_aerospace else "Non-aerospace document detected. Baseline telemetry cannot be established for unrelated documents.",
    )
