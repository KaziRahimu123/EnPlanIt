"use client";

import { Suspense, useState, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  runScenario,
  getScenarioInsights,
  getMission,
  listMissions,
  listDocuments,
  getMissionFacts,
  getSavedScenario,
  getMissionBeforeValues,
  type ScenarioVariables,
  type ScenarioRunResponse,
  type ScenarioInsightsResponse,
  type ConcernLevel,
  type BeforeValueInfo,
  type Mission,
  type MissionDocument,
  type DocumentFact,
} from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import ScenarioInsightsVisualizer from "@/components/ScenarioInsightsVisualizer";

// ---------------------------------------------------------------------------
// Variable definitions — order, labels, units, bounds, defaults
// ---------------------------------------------------------------------------

interface VarDef {
  key: keyof ScenarioVariables;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default: number;
}

const VAR_DEFS: VarDef[] = [
  {
    key: "mission_duration_days",
    label: "Mission Duration",
    unit: "days",
    min: 0.1,
    max: 36500,
    step: 1,
    default: 90,
  },
  {
    key: "solar_power_pct",
    label: "Solar Power Availability",
    unit: "%",
    min: 0,
    max: 1000,
    step: 1,
    default: 100,
  },
  {
    key: "battery_capacity_kwh",
    label: "Battery Capacity",
    unit: "kWh",
    min: 0,
    max: 1000000,
    step: 1,
    default: 100,
  },
  {
    key: "daily_power_consumption_kwh",
    label: "Daily Power Consumption",
    unit: "kWh",
    min: 0.01,
    max: 1000000,
    step: 0.1,
    default: 20,
  },
  {
    key: "communication_delay_min",
    label: "Communication Delay",
    unit: "min",
    min: 0,
    max: 100000,
    step: 1,
    default: 10,
  },
  {
    key: "resource_availability_pct",
    label: "Resource Availability",
    unit: "%",
    min: 0,
    max: 1000,
    step: 1,
    default: 100,
  },
];

const CONCERN_LABELS: Record<string, string> = {
  power: "Power",
  resources: "Resources",
  communication: "Communication",
  mission_duration: "Mission Duration",
};

const DEFAULTS: ScenarioVariables = Object.fromEntries(
  VAR_DEFS.map((v) => [v.key, v.default]),
) as unknown as ScenarioVariables;

// Sentinel: used in BEFORE display when no value is available from mission data
const NOT_PROVIDED = null;

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function ConcernBadge({ level }: { level: ConcernLevel }) {
  const styles: Record<ConcernLevel, string> = {
    LOW: "border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)]",
    MEDIUM: "border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)]",
    HIGH: "border-[var(--red)]/40 bg-[var(--red)]/10 text-red-400",
    NOT_SPECIFIED: "border-slate-700 bg-slate-800/40 text-slate-400",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9.5px] font-mono font-bold uppercase tracking-wider ${
        styles[level] ?? styles.NOT_SPECIFIED
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          level === "LOW"
            ? "bg-[var(--green)]"
            : level === "MEDIUM"
              ? "bg-[var(--amber)]"
              : level === "HIGH"
                ? "bg-red-400"
                : "bg-slate-500"
        }`}
      />
      {level === "NOT_SPECIFIED" ? "Not Specified" : level}
    </span>
  );
}

function ConcernArrow({ before, after }: { before: ConcernLevel; after: ConcernLevel }) {
  const rank: Record<ConcernLevel, number> = { NOT_SPECIFIED: -1, LOW: 0, MEDIUM: 1, HIGH: 2 };
  const diff = rank[after] - rank[before];
  if (diff === 0)
    return <span className="text-[var(--text-muted)] text-xs font-mono">→</span>;
  if (diff > 0)
    return <span className="text-red-400 text-xs font-bold font-mono">↑</span>;
  return <span className="text-[var(--green)] text-xs font-bold font-mono">↓</span>;
}

// ---------------------------------------------------------------------------
// AI Insights panel
// ---------------------------------------------------------------------------

const INSIGHT_SECTIONS: Array<{
  key: keyof NonNullable<ScenarioInsightsResponse["insights"]>;
  label: string;
  icon: string;
}> = [
  { key: "what_changed",             label: "What Changed",              icon: "🔄" },
  { key: "why_it_matters",           label: "Why It Matters",            icon: "💡" },
  { key: "possible_mission_impact",  label: "Possible Mission Impact",   icon: "🛸" },
  { key: "what_to_investigate_next", label: "What to Investigate Next",  icon: "🔬" },
];

function AiInsightsPanel({ insightsRes }: { insightsRes: ScenarioInsightsResponse | null }) {
  return <ScenarioInsightsVisualizer insightsRes={insightsRes} />;
}

// ---------------------------------------------------------------------------
// Main content (inside Suspense — uses useSearchParams)
// ---------------------------------------------------------------------------

// afterValues allows "" so inputs can be temporarily cleared while editing
type AfterValues = Record<keyof ScenarioVariables, number | "">;

// BEFORE values: number if known from docs/saved scenario, null if NOT PROVIDED
type BeforeValues = Record<keyof ScenarioVariables, number | null>;
type BeforeMeta = Record<keyof ScenarioVariables, BeforeValueInfo | null>;

function isAerospaceText(text?: string | null): boolean {
  if (!text || text.trim().length < 10) return false;
  const lower = text.toLowerCase();
  const spaceIndicators = [
    "spacecraft", "space mission", "lunar", "moon", "mars", "orbit", "orbital",
    "deep space", "shackleton", "crater", "planetary", "astronaut", "crew complement",
    "payload", "propulsion", "launch vehicle", "interplanetary", "satellite",
    "isru", "eclss", "eva", "ground control", "space station", "trajectory",
    "rover", "lander", "telemetry link", "habitat", "surface outpost", "microgravity",
    "radiation shielding", "photovoltaic array", "solar array technology",
    "helios", "artemis", "apollo", "ares", "europa clipper", "space exploration"
  ];
  return spaceIndicators.filter(kw => lower.includes(kw)).length >= 2;
}

function parseDurationDays(str?: string | null): number | null {
  if (!str) return null;
  const s = str.toLowerCase().trim();
  const m = s.match(/(?:operational\s+timeline|mission\s+duration|duration|planned\s+for|lasting)\s*(\d+(?:\.\d+)?)\s*(-|\s)?\s*(months?|mos?|years?|yrs?|days?|d|weeks?|wks?|w|sols?)/i) || s.match(/^(\d+(?:\.\d+)?)\s*(-|\s)?\s*(months?|mos?|years?|yrs?|days?|d|weeks?|wks?|w|sols?)$/i);
  if (m) {
    const n = parseFloat(m[1]);
    if (!isNaN(n)) {
      const unit = m[3].toLowerCase();
      if (unit.startsWith("y")) return Math.round(n * 365);
      if (unit.startsWith("m") && !unit.startsWith("min")) return Math.round(n * 30);
      if (unit.startsWith("w")) return Math.round(n * 7);
      if (unit.startsWith("sol")) return Math.round(n * 1.027);
      return Math.round(n);
    }
  }
  return null;
}

function extractMissionBaseline(
  mission: Mission | null,
  facts: DocumentFact[],
  serverBeforeValues?: BeforeValueInfo[]
): { values: BeforeValues; meta: BeforeMeta } {
  const values: BeforeValues = {
    mission_duration_days: null,
    solar_power_pct: null,
    battery_capacity_kwh: null,
    daily_power_consumption_kwh: null,
    communication_delay_min: null,
    resource_availability_pct: null,
  };
  const meta: BeforeMeta = {
    mission_duration_days: null,
    solar_power_pct: null,
    battery_capacity_kwh: null,
    daily_power_consumption_kwh: null,
    communication_delay_min: null,
    resource_availability_pct: null,
  };

  const isAerospace = isAerospaceText(mission?.description) && !mission?.destination?.toLowerCase().includes("non-aerospace");

  // 1. Check document facts first (only if state is not_specified/empty facts are ignored)
  for (const f of facts) {
    if (f.numeric_value !== null && f.numeric_value !== undefined && f.state !== "not_specified") {
      const key = f.field_key as keyof ScenarioVariables;
      if (key in values && (values[key] === null || values[key] === undefined)) {
        values[key] = f.numeric_value;
        meta[key] = {
          key: f.field_key,
          label: f.label,
          unit: f.unit || "",
          value: f.numeric_value,
          state: f.state,
          source_label: "Document Fact",
          source_text: f.source_text,
        };
      }
    }
  }

  // 2. Extract strictly from Mission fields if aerospace
  if (mission && isAerospace) {
    const desc = (mission.description || "").toLowerCase();
    const pSrc = (mission.power_source || "").toLowerCase();
    const kRes = (mission.known_resources || "").toLowerCase();

    // A. Duration
    if (values.mission_duration_days === null || values.mission_duration_days === undefined) {
      const durDays = parseDurationDays(mission.duration) || parseDurationDays(mission.description);
      if (durDays !== null) {
        values.mission_duration_days = durDays;
        meta.mission_duration_days = {
          key: "mission_duration_days",
          label: "Mission Duration",
          unit: "days",
          value: durDays,
          state: "extracted",
          source_label: `Mission Profile (${mission.duration || durDays + "d"})`,
          source_text: mission.duration || `Extracted from description: ${durDays} days`,
        };
      }
    }

    // B. Solar Power Availability
    if (values.solar_power_pct === null || values.solar_power_pct === undefined) {
      if ((pSrc.includes("solar") || pSrc.includes("pv") || desc.includes("solar") || desc.includes("pv")) && pSrc !== "unknown") {
        values.solar_power_pct = 100;
        meta.solar_power_pct = {
          key: "solar_power_pct",
          label: "Solar Power Availability",
          unit: "%",
          value: 100,
          state: "extracted",
          source_label: "Mission Profile (Solar)",
          source_text: mission.power_source || "Solar power indicated in mission description",
        };
      }
    }

    // C. Resource Availability
    if (values.resource_availability_pct === null || values.resource_availability_pct === undefined) {
      const isValidRes = kRes && kRes !== "unknown" && kRes !== "[]" && kRes !== "";
      const isDescRes = desc.includes("water") || desc.includes("oxygen") || desc.includes("isru") || (desc.includes("resource") && desc.includes("life support"));
      if (isValidRes || isDescRes) {
        values.resource_availability_pct = 100;
        meta.resource_availability_pct = {
          key: "resource_availability_pct",
          label: "Resource Availability",
          unit: "%",
          value: 100,
          state: "extracted",
          source_label: "Mission Profile (Resources)",
          source_text: mission.known_resources || "In-situ resources and consumables indicated in description",
        };
      }
    }

    // D. Communication Delay
    if (values.communication_delay_min === null || values.communication_delay_min === undefined) {
      const commMatch1 = desc.match(/(?:one-way\s+)?(?:communication\s+)?(?:delay|latency|lag|comm\s+delay|signal\s+delay)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*[\-\s]*(minutes?|mins?|seconds?|secs?|hours?|hrs?)/i);
      const commMatch2 = desc.match(/(\d+(?:\.\d+)?)\s*[\-\s]*(minutes?|mins?|seconds?|secs?|hours?|hrs?)\s*(?:[a-z\-]+\s+){0,3}(?:delay|latency|lag|comm)/i);
      const commMatch = commMatch1 || commMatch2;
      if (commMatch) {
        const rawVal = parseFloat(commMatch[1]);
        const unitStr = (commMatch[2] || "").toLowerCase();
        const isSec = unitStr.startsWith("sec");
        const isHr = unitStr.startsWith("hour") || unitStr.startsWith("hr");
        const minVal = isSec ? Math.round((rawVal / 60) * 1000) / 1000 : (isHr ? rawVal * 60 : rawVal);
        const displayUnit = isSec ? "sec" : (isHr ? "hr" : "min");

        values.communication_delay_min = minVal;
        meta.communication_delay_min = {
          key: "communication_delay_min",
          label: "Communication Delay",
          unit: displayUnit,
          value: isSec ? rawVal : minVal,
          state: "extracted",
          source_label: `Description (${rawVal} ${displayUnit})`,
          source_text: commMatch[0],
        };
      }
    }

    // E. Battery Capacity
    if (values.battery_capacity_kwh === null || values.battery_capacity_kwh === undefined) {
      const batMatch1 = desc.match(/(\d+(?:\.\d+)?)\s*kwh\s*(?:[a-z\-]+\s+){0,3}(?:battery|storage|reserve|bank)/i);
      const batMatch2 = desc.match(/(?:battery|storage|energy storage|reserve)\s*(?:capacity|bank|system|reserve|size)?\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*kwh/i);
      const batMatch = batMatch1 || batMatch2;
      if (batMatch) {
        const batVal = parseFloat(batMatch[1]);
        values.battery_capacity_kwh = batVal;
        meta.battery_capacity_kwh = {
          key: "battery_capacity_kwh",
          label: "Battery Capacity",
          unit: "kWh",
          value: batVal,
          state: "extracted",
          source_label: "Description (Battery)",
          source_text: batMatch[0],
        };
      }
    }

    // F. Daily Power Consumption
    if (values.daily_power_consumption_kwh === null || values.daily_power_consumption_kwh === undefined) {
      const powMatch1 = desc.match(/(?:daily\s*(?:station\s*)?power\s*consumption|daily\s*draw|consumption|power\s*consumption|daily\s*station\s*load|power\s*demand)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*kwh/i);
      const powMatch2 = desc.match(/(\d+(?:\.\d+)?)\s*kwh\s*(?:per\s*(?:sol|day)|daily\s*(?:power\s*)?consumption|daily\s*draw)/i);
      const powMatch = powMatch1 || powMatch2;
      if (powMatch) {
        const powVal = parseFloat(powMatch[1]);
        values.daily_power_consumption_kwh = powVal;
        meta.daily_power_consumption_kwh = {
          key: "daily_power_consumption_kwh",
          label: "Daily Power Consumption",
          unit: "kWh",
          value: powVal,
          state: "extracted",
          source_label: "Description (Power Consumption)",
          source_text: powMatch[0],
        };
      }
    }
  }

  // 3. Fall back to server-provided before values (only if aerospace)
  if (serverBeforeValues && isAerospace) {
    for (const v of serverBeforeValues) {
      const key = v.key as keyof ScenarioVariables;
      if (values[key] === null || values[key] === undefined) {
        if (v.value !== null && v.value !== undefined && v.state !== "not_specified") {
          values[key] = v.value;
          meta[key] = v;
        }
      }
    }
  }

  return { values, meta };
}

const BLANK_AFTER: AfterValues = Object.fromEntries(
  VAR_DEFS.map((v) => [v.key, ""]),
) as unknown as AfterValues;

function ScenarioContent() {
  const params = useSearchParams();
  const rawMissionId = params.get("missionId");

  const [missionsList, setMissionsList] = useState<Mission[]>([]);
  const [activeMissionId, setActiveMissionId] = useState<string | null>(rawMissionId);
  const [currentMission, setCurrentMission] = useState<Mission | null>(null);
  const [documents, setDocuments] = useState<MissionDocument[]>([]);
  const [facts, setFacts] = useState<DocumentFact[]>([]);

  // BEFORE: from mission documents / saved scenario. null = NOT PROVIDED
  const [beforeValues, setBeforeValues] = useState<BeforeValues>(
    Object.fromEntries(VAR_DEFS.map((v) => [v.key, NOT_PROVIDED])) as BeforeValues,
  );
  const [beforeMeta, setBeforeMeta] = useState<BeforeMeta>(
    Object.fromEntries(VAR_DEFS.map((v) => [v.key, null])) as BeforeMeta,
  );
  const [beforeLoaded, setBeforeLoaded] = useState(false);
  const [hasDocData, setHasDocData] = useState(false);

  // AFTER: editable; starts blank ("") so user can input custom scenario changes
  const [afterValues, setAfterValues] = useState<AfterValues>({ ...BLANK_AFTER });
  const [result, setResult] = useState<ScenarioRunResponse | null>(null);
  const [insightsRes, setInsightsRes] = useState<ScenarioInsightsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedBanner, setSavedBanner] = useState(false);
  const [missionContext, setMissionContext] = useState<string | null>(null);
  const [briefingExpanded, setBriefingExpanded] = useState(false);
  const [showDossierModal, setShowDossierModal] = useState(false);

  // Live dynamic environmental telemetry & NASA life-support burn model
  const activeEnvironment = useMemo(() => {
    const dest = result?.environment?.destination || currentMission?.destination || "Target Surface / Orbit";
    const destLower = dest.toLowerCase();
    const descLower = (currentMission?.description || "").toLowerCase();

    // 1. Crew size: parse from description or default to 4
    let crewSize = result?.environment?.crew_size || 4;
    const cMatch = descLower.match(/crew\s*(?:complement|size|of)?\s*:?\s*(\d+)/i);
    if (cMatch) crewSize = parseInt(cMatch[1], 10);

    // 2. Active duration in days (reactive to afterValues in real-time)
    const effectiveDays =
      typeof afterValues.mission_duration_days === "number" && !isNaN(afterValues.mission_duration_days) && afterValues.mission_duration_days > 0
        ? afterValues.mission_duration_days
        : typeof beforeValues.mission_duration_days === "number" && !isNaN(beforeValues.mission_duration_days)
        ? beforeValues.mission_duration_days
        : currentMission
        ? parseDurationDays(currentMission.duration) || 365
        : 365;

    // 3. Planetary illumination & eclipse physics
    let solarFlux = 1361.0;
    let fluxPct = 100.0;
    let dayNightStr = "Polar (86% Sun)";
    let eclipseStr = "Max shadow: 54h";
    const isMoon = destLower.includes("moon") || destLower.includes("lunar") || destLower.includes("shackleton");
    const isMars = destLower.includes("mars");
    const isLeo = destLower.includes("leo") || destLower.includes("earth") || destLower.includes("orbit");

    if (isMoon) {
      solarFlux = 1361.0;
      fluxPct = 100.0;
      if (destLower.includes("shackleton") || destLower.includes("polar") || destLower.includes("south pole")) {
        dayNightStr = "Polar (86% Sun)";
        eclipseStr = "Max shadow: 54h";
      } else {
        dayNightStr = "708.7h (29.5d)";
        eclipseStr = "Night: 354h";
      }
    } else if (isMars) {
      solarFlux = 590.0;
      fluxPct = 43.4;
      dayNightStr = "24.6h Sol";
      eclipseStr = "Night: 12.3h";
    } else if (isLeo) {
      solarFlux = 1361.0;
      fluxPct = 100.0;
      dayNightStr = "92 min Orbit";
      eclipseStr = "Eclipse: 36 min";
    } else {
      solarFlux = 1361.0;
      fluxPct = 100.0;
      dayNightStr = "Continuous Sun";
      eclipseStr = "Eclipse: 1.2h";
    }

    // 4. NASA-STD-3001 Consumable Burn (2.5 kg water, 4.8 kg total/person/day)
    const dailyWaterKg = Math.round(crewSize * 2.5 * 10) / 10;
    const dailyTotalConsumablesKg = Math.round(crewSize * 4.8 * 10) / 10;
    const totalConsumablesKg = Math.round(effectiveDays * dailyTotalConsumablesKg);

    // 5. Radiation dose (0.70 mSv/day for surface, 1.2 mSv/day deep space)
    const dailyRadMsv = isMoon || isMars ? 0.70 : isLeo ? 0.35 : 1.20;
    const estimatedRadMsv = Math.round(effectiveDays * dailyRadMsv * 10) / 10;
    const careerLimitPct = Math.round((estimatedRadMsv / 600.0) * 1000) / 10;

    return {
      destination: dest,
      solar_flux_w_m2: solarFlux,
      solar_flux_pct_of_earth: fluxPct,
      day_night_cycle_hours: dayNightStr,
      max_eclipse_hours: eclipseStr,
      crew_size: crewSize,
      daily_water_burn_kg: dailyWaterKg,
      daily_total_consumables_kg: dailyTotalConsumablesKg,
      total_consumables_kg: totalConsumablesKg,
      estimated_radiation_msv: estimatedRadMsv,
      career_limit_pct: careerLimitPct,
      effective_days: effectiveDays,
    };
  }, [result, currentMission, afterValues, beforeValues]);

  // 1. Fetch available missions & resolve activeMissionId
  useEffect(() => {
    listMissions()
      .then((ms) => {
        setMissionsList(ms);
        if (!rawMissionId) {
          const stored = typeof window !== "undefined" ? (localStorage.getItem("enplanit_last_mission_id") || localStorage.getItem("astroops_last_mission_id")) : null;
          if (stored && ms.some((m) => m.id === stored)) {
            setActiveMissionId(stored);
          } else if (ms.length > 0) {
            setActiveMissionId(ms[0].id);
          }
        }
      })
      .catch(() => {});
  }, [rawMissionId]);

  // 2. Load active mission data, documents, facts, and before values
  useEffect(() => {
    if (!activeMissionId) return;

    if (typeof window !== "undefined") {
      localStorage.setItem("enplanit_last_mission_id", activeMissionId);
    }

    let loadedMission: Mission | null = null;
    let loadedFacts: DocumentFact[] = [];
    let loadedServerBefore: BeforeValueInfo[] = [];

    // Parallel load
    Promise.all([
      getMission(activeMissionId)
        .then((m) => {
          loadedMission = m;
          setCurrentMission(m);
          setMissionContext(m.description);
        })
        .catch(() => {}),
      listDocuments(activeMissionId)
        .then(setDocuments)
        .catch(() => setDocuments([])),
      getMissionFacts(activeMissionId)
        .then((res) => {
          loadedFacts = res.facts;
          setFacts(res.facts);
        })
        .catch(() => setFacts([])),
      getMissionBeforeValues(activeMissionId)
        .then((res) => {
          loadedServerBefore = res.values;
          setHasDocData(res.has_document_data);
        })
        .catch(() => {}),
    ]).finally(() => {
      const { values, meta } = extractMissionBaseline(
        loadedMission,
        loadedFacts,
        loadedServerBefore
      );
      setBeforeValues(values);
      setBeforeMeta(meta);
      setBeforeLoaded(true);
    });

    // Check URL parameters for variable overrides (e.g. from Digital Twin simulation)
    const urlOverrides: Partial<AfterValues> = {};
    let hasUrlOverrides = false;
    for (const v of VAR_DEFS) {
      const paramVal = params.get(v.key);
      if (paramVal !== null && paramVal !== undefined && paramVal !== "") {
        const parsed = parseFloat(paramVal);
        if (!isNaN(parsed)) {
          urlOverrides[v.key] = parsed;
          hasUrlOverrides = true;
        }
      }
    }
    if (hasUrlOverrides) {
      setAfterValues((prev) => ({ ...prev, ...urlOverrides }));
    }

    // Attempt to load a previously saved scenario
    getSavedScenario(activeMissionId)
      .then((saved) => {
        if (!hasUrlOverrides && saved.after_vars) {
          const cleanAfter: Partial<AfterValues> = {};
          for (const key of Object.keys(saved.after_vars) as Array<keyof ScenarioVariables>) {
            const val = saved.after_vars[key];
            if (typeof val === "number" && val > 0) {
              cleanAfter[key] = val;
            }
          }
          if (Object.keys(cleanAfter).length > 0) {
            setAfterValues((prev) => ({ ...prev, ...cleanAfter }));
          }
        }
        if (saved.concerns_before && saved.concerns_after && saved.changes) {
          setResult({
            mission_id: activeMissionId,
            concerns_before: saved.concerns_before,
            concerns_after: saved.concerns_after,
            changes: saved.changes,
          });
        }
        if (saved.insights) {
          setInsightsRes({
            mission_id: activeMissionId,
            insights: saved.insights,
            ai_available: true,
            error: null,
          });
        }
      })
      .catch(() => {});
  }, [activeMissionId, params]);

  function handleSwitchMission(newId: string) {
    setActiveMissionId(newId);
    setResult(null);
    setInsightsRes(null);
    setError(null);
    setSavedBanner(false);
  }

  function handleChange(key: keyof ScenarioVariables, raw: string) {
    if (raw === "") {
      setAfterValues((prev) => ({ ...prev, [key]: "" }));
      return;
    }
    const num = parseFloat(raw);
    if (!isNaN(num)) setAfterValues((prev) => ({ ...prev, [key]: num }));
  }

  function handleReset() {
    setAfterValues({ ...BLANK_AFTER });
    setResult(null);
    setInsightsRes(null);
    setError(null);
    setSavedBanner(false);
  }

  function applyPreset(preset: Partial<ScenarioVariables>) {
    setAfterValues((prev) => ({
      ...prev,
      ...preset,
    }));
  }

  // Build the effective BEFORE vars for the scenario run
  function buildBeforeVars(): ScenarioVariables {
    const result: Partial<ScenarioVariables> = {};
    for (const v of VAR_DEFS) {
      const missionVal = beforeValues[v.key as keyof ScenarioVariables];
      const validVal = typeof missionVal === "number" && !isNaN(missionVal) && isFinite(missionVal);
      // If not specified in the mission dossier, use 0 to flag as an unverified planning gap
      result[v.key as keyof ScenarioVariables] = validVal ? missionVal : 0;
    }
    return result as ScenarioVariables;
  }

  // Build the effective AFTER vars for the scenario run:
  // If an AFTER field is left blank ("") or invalid, it inherits the BEFORE value!
  function buildEffectiveAfterVars(): ScenarioVariables {
    const effectiveBefore = buildBeforeVars();
    const result: Partial<ScenarioVariables> = {};
    for (const v of VAR_DEFS) {
      const userVal = afterValues[v.key];
      const validVal = typeof userVal === "number" && !isNaN(userVal) && isFinite(userVal);
      if (validVal) {
        result[v.key] = userVal;
      } else {
        result[v.key] = effectiveBefore[v.key];
      }
    }
    return result as ScenarioVariables;
  }

  async function handleRun() {
    setLoading(true);
    setError(null);
    setInsightsRes(null);
    setSavedBanner(false);
    try {
      const safeAfter = buildEffectiveAfterVars();
      const effectiveBefore = buildBeforeVars();
      const res = await runScenario(activeMissionId, effectiveBefore, safeAfter, !!activeMissionId);
      setResult(res);
      if (activeMissionId) setSavedBanner(true);

      setInsightsLoading(true);
      getScenarioInsights(
        activeMissionId,
        missionContext,
        res.concerns_before,
        res.concerns_after,
        res.changes,
        !!activeMissionId,
      )
        .then(setInsightsRes)
        .catch((e) =>
          setInsightsRes({
            mission_id: activeMissionId,
            insights: null,
            ai_available: false,
            error: e instanceof Error ? e.message : "Insights failed",
          }),
        )
        .finally(() => setInsightsLoading(false));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scenario run failed.");
    } finally {
      setLoading(false);
    }
  }

  const effectiveBefore = buildBeforeVars();
  const changedCount = VAR_DEFS.filter((v) => {
    const after = afterValues[v.key];
    return after !== "" && after !== effectiveBefore[v.key as keyof ScenarioVariables];
  }).length;

  const isNonAerospace = Boolean(
    currentMission &&
      (!isAerospaceText(currentMission.description) ||
        currentMission.destination?.toLowerCase().includes("non-aerospace") ||
        currentMission.destination?.toLowerCase().includes("unknown"))
  );

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 py-6 space-y-5">
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-muted)] mb-1 uppercase tracking-widest font-mono">
            <span className="w-3.5 h-px bg-[var(--accent)]" />
            Scenario Lab · Systems Modeling
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">Scenario Lab</h1>
          <p className="text-[var(--text-muted)] text-xs max-w-xl font-mono mt-0.5">
            Adjust variables in the <strong className="text-sky-300">AFTER</strong> column to simulate subsystem trade-offs.
          </p>
        </div>
      </div>

      {/* ── Non-Aerospace Document Alert Banner ── */}
      {isNonAerospace && (
        <div className="rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-950/30 to-[#030914] p-4 flex items-start gap-3.5 shadow-xl">
          <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center flex-shrink-0 text-amber-400 text-base font-bold">
            ⚠️
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-mono font-bold text-amber-300 uppercase tracking-wider">
                Non-Aerospace Document / Unrelated Mission Profile Detected
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Baseline Telemetry Unspecified
              </span>
            </div>
            <p className="text-xs font-mono text-slate-300 mt-1.5 leading-relaxed">
              The uploaded document or mission description does not match a space exploration profile. Baseline telemetry variables are set to <strong>Not Provided</strong> to prevent false assumptions. You can manually enter test variables in the <strong>AFTER</strong> column to run what-if simulations, or attach an aerospace mission dossier on Create Mission.
            </p>
          </div>
        </div>
      )}

      {/* ── Compact Top Mission Briefing Card ── */}
      {currentMission && (
        <div className="rounded-xl border border-[#1e3a5f]/80 bg-gradient-to-b from-[#071326]/90 to-[#030914]/95 p-4 backdrop-blur-md shadow-xl relative overflow-hidden space-y-3">
          <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-transparent via-[var(--accent-glow)] to-transparent opacity-80" />

          {/* Top Row: Status, Switcher, ID & Inspect button */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9.5px] font-mono font-bold uppercase tracking-wider ${
                isNonAerospace
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-300"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${isNonAerospace ? "bg-amber-400" : "bg-sky-400"} animate-pulse`} />
                {isNonAerospace ? "UNRELATED MISSION PROFILE" : currentMission.status || "ACTIVE MISSION"}
              </span>

              {/* Mission Switcher Dropdown */}
              {missionsList.length > 1 && (
                <select
                  value={activeMissionId || ""}
                  onChange={(e) => handleSwitchMission(e.target.value)}
                  className="bg-[#050e1e] border border-[#1e3a5f] text-[10px] font-mono text-[var(--text-primary)] rounded px-2 py-0.5 outline-none hover:border-sky-500/60 transition-all cursor-pointer"
                >
                  {missionsList.map((m) => (
                    <option key={m.id} value={m.id} className="bg-[#050e1e] text-white">
                      {m.name || `Mission ${m.id.slice(0, 8)}`}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowDossierModal(true)}
                className="px-2.5 py-1 rounded border border-[#1e3a5f] bg-[#030914] text-[10px] font-mono font-semibold text-slate-300 hover:text-white hover:border-sky-500/60 transition-all flex items-center gap-1.5"
                title="Inspect Full Mission Dossier"
              >
                <span>🔍</span>
                <span>Inspect Dossier</span>
              </button>
            </div>
          </div>

          {/* Middle Row: Mission Title & Compact 2-Line Clickable Description */}
          <div>
            <h2 className="text-lg font-bold text-white font-mono tracking-tight mb-1">
              {currentMission.name || "Mission Digital Twin"}
            </h2>
            <div
              onClick={() => setBriefingExpanded(!briefingExpanded)}
              className="cursor-pointer group/desc rounded-lg border border-[#1e3a5f]/40 bg-[#01040a]/70 p-2.5 hover:border-sky-500/40 transition-colors"
            >
              <p className={`text-xs font-mono text-slate-300 leading-relaxed ${briefingExpanded ? "" : "line-clamp-2"}`}>
                {currentMission.description || "No mission description provided."}
              </p>
              {currentMission.description && currentMission.description.length > 120 && (
                <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-sky-400 font-semibold pt-0.5 border-t border-[#1e3a5f]/20">
                  <span className="group-hover/desc:underline">
                    {briefingExpanded ? "Click to collapse description ▲" : "Click to expand full description ▼"}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Row: Quick Telemetry Chips */}
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {currentMission.destination && (
              <div className="px-2 py-0.5 rounded border border-[#1e3a5f] bg-[#050f20] text-[9.5px] font-mono">
                <span className="text-[var(--text-muted)]">Destination: </span>
                <strong className={isNonAerospace ? "text-amber-300" : "text-sky-300"}>{currentMission.destination}</strong>
              </div>
            )}
            {currentMission.duration && (
              <div className="px-2 py-0.5 rounded border border-[#1e3a5f] bg-[#050f20] text-[9.5px] font-mono">
                <span className="text-[var(--text-muted)]">Duration: </span>
                <strong className={isNonAerospace ? "text-slate-400" : "text-emerald-300"}>{currentMission.duration}</strong>
              </div>
            )}
            {currentMission.power_source && currentMission.power_source.toLowerCase() !== "unknown" && (
              <div className="px-2 py-0.5 rounded border border-[#1e3a5f] bg-[#050f20] text-[9.5px] font-mono">
                <span className="text-[var(--text-muted)]">Power: </span>
                <strong className="text-amber-300 truncate max-w-[160px] inline-block align-bottom">{currentMission.power_source}</strong>
              </div>
            )}
            <div className="px-2 py-0.5 rounded border border-[#1e3a5f] bg-[#050f20] text-[9.5px] font-mono text-slate-400">
              📄 {documents.length} Attached Doc{documents.length !== 1 ? "s" : ""}
            </div>
          </div>
        </div>
      )}

      {/* ── Mission Dossier Modal for Scenario Lab ── */}
      {showDossierModal && currentMission && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-2xl rounded-xl border border-sky-500/50 bg-[#030a18] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-[#1e3a5f] bg-[#020612] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-lg">📄</span>
                <div>
                  <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                    {currentMission.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-sky-400">
                      Destination: {currentMission.destination || "Target Surface / Orbit"}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border border-sky-500/40 bg-sky-500/10 text-sky-300 uppercase">
                      Showing up to 5,000 characters
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowDossierModal(false)}
                className="w-7 h-7 rounded border border-[#1e3a5f] bg-[#030914] text-slate-400 hover:text-white hover:border-slate-400 transition-colors flex items-center justify-center text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    Complete Flight Specification & Profile:
                  </span>
                  <span className="text-[9px] font-mono text-sky-400 font-semibold">
                    Showing {Math.min((currentMission.description || "").length, 5000).toLocaleString()} / 5,000 characters
                  </span>
                </div>
                <div className="p-4 rounded-lg border border-[#1e3a5f] bg-[#01040a] text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap selection:bg-sky-500/30">
                  {(currentMission.description || "No description provided.").slice(0, 5000)}
                </div>
              </div>

              {/* Quick Specs bar */}
              <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#1e3a5f]/50">
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Duration</div>
                  <div className="text-xs font-mono font-bold text-emerald-300 mt-0.5 truncate">
                    {currentMission.duration || "Planned"}
                  </div>
                </div>
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Power Source</div>
                  <div className="text-xs font-mono font-bold text-amber-300 mt-0.5 truncate">
                    {currentMission.power_source || "Solar / Battery"}
                  </div>
                </div>
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Resources</div>
                  <div className="text-xs font-mono font-bold text-sky-300 mt-0.5 truncate">
                    {currentMission.known_resources || "Closed-Loop"}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#1e3a5f] bg-[#020612] flex items-center justify-between gap-2">
              <button
                onClick={() => {
                  if (currentMission.description) {
                    navigator.clipboard.writeText(currentMission.description);
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#030914] text-xs font-mono text-slate-300 hover:text-white transition-colors"
              >
                Copy Text 📋
              </button>
              <button
                onClick={() => setShowDossierModal(false)}
                className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-semibold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Doc data banner — shown when BEFORE values loaded from documents ── */}
      {activeMissionId && beforeLoaded && hasDocData && !savedBanner && (
        <div className="mb-5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-3 flex items-center gap-2 text-sm text-[var(--accent-glow)]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
            <rect x="2" y="1" width="8" height="11" rx="1" stroke="currentColor" strokeWidth="1.2" />
            <path d="M4 4h5M4 6.5h5M4 9h3" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
          </svg>
          <span>BEFORE values loaded from mission documents and baseline intelligence. Review and edit AFTER values to simulate.</span>
        </div>
      )}

      {/* ── Saved restore banner ── */}
      {savedBanner && activeMissionId && (
        <div className="mb-5 rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 px-5 py-3 flex items-center gap-2 text-sm text-[var(--green)]">
          <span>✓</span>
          <span>Scenario saved to your mission.</span>
        </div>
      )}

      {/* ── TOP: SIMULATION COCKPIT (Perfect 2-Column Equal-Height Balance) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* ── LEFT: simulation variable matrix ── */}
        <div className="lg:col-span-6 flex flex-col justify-between space-y-3">
          {/* Quick Scenario Stress Presets */}
          <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#040c1a] p-2.5">
            <div className="text-[9.5px] text-[var(--text-muted)] uppercase tracking-wider font-mono mb-1.5 flex items-center justify-between">
              <span>Quick Scenario Presets</span>
              <span className="text-[8.5px] text-[var(--accent-glow)]">1-Click Test</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => applyPreset({ solar_power_pct: 55 })}
                className="px-2 py-0.5 rounded text-[10.5px] font-mono border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-all flex items-center gap-1"
              >
                ⚡ Solar -45%
              </button>
              <button
                type="button"
                onClick={() => {
                  const baseDur = beforeValues.mission_duration_days ?? 90;
                  applyPreset({ mission_duration_days: baseDur + 180 });
                }}
                className="px-2 py-0.5 rounded text-[10.5px] font-mono border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-all flex items-center gap-1"
              >
                ⏱️ +180d
              </button>
              <button
                type="button"
                onClick={() => applyPreset({ communication_delay_min: 35 })}
                className="px-2 py-0.5 rounded text-[10.5px] font-mono border border-purple-500/40 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-all flex items-center gap-1"
              >
                📡 35m Comm
              </button>
              <button
                type="button"
                onClick={handleReset}
                className="px-2 py-0.5 rounded text-[10.5px] font-mono border border-slate-700 bg-slate-800/40 text-slate-400 hover:text-white transition-all ml-auto"
              >
                ↺ Clear
              </button>
            </div>
          </div>

          {/* Unified Telemetry Variable Matrix */}
          <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#040c1a] overflow-hidden shadow-lg flex-1 flex flex-col justify-between">
            <div className="px-3.5 py-2 border-b border-[#1e3a5f]/50 bg-[#020712] flex items-center justify-between">
              <span className="text-[10px] font-mono font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚙️</span> Telemetry Variable Matrix
              </span>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">
                6 Active Subsystems
              </span>
            </div>

            <div className="divide-y divide-[#1e3a5f]/40">
              {VAR_DEFS.map((v) => {
                const val = afterValues[v.key];
                const isBlank = val === "";
                const beforeVal = beforeValues[v.key as keyof ScenarioVariables];
                const beforeIsProvided = beforeVal !== null && beforeVal !== undefined;
                const meta = beforeMeta[v.key as keyof ScenarioVariables];
                const isChanged = !isBlank && val !== (beforeIsProvided ? beforeVal : v.default);

                return (
                  <div
                    key={v.key}
                    className={`px-3 py-2 flex items-center justify-between gap-2.5 transition-colors ${
                      isChanged ? "bg-sky-500/10" : "hover:bg-[#061124]"
                    }`}
                  >
                    {/* Variable Name + Unit */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-medium text-white truncate">
                          {v.label}
                        </span>
                        {isChanged && (
                          <span className="text-[8px] font-mono px-1 py-0.2 rounded bg-sky-500/20 text-sky-300 border border-sky-500/40 font-bold">
                            MOD
                          </span>
                        )}
                      </div>
                      <div className="text-[8.5px] font-mono text-[var(--text-muted)] flex items-center gap-1 mt-0.5">
                        <span>Baseline:</span>
                        <strong className="text-slate-300">
                          {beforeIsProvided ? `${beforeVal} ${v.unit}` : "Not provided"}
                        </strong>
                      </div>
                    </div>

                    {/* BEFORE Pill (Hidden on mobile) */}
                    <div className="hidden sm:block text-right shrink-0">
                      <span className="text-[9.5px] font-mono font-semibold px-2 py-0.5 rounded border border-[#1e3a5f]/60 bg-[#020712] text-slate-300">
                        {beforeIsProvided ? `${beforeVal} ${v.unit}` : "—"}
                      </span>
                    </div>

                    {/* AFTER Input */}
                    <div className="w-28 shrink-0 flex items-center gap-1">
                      <input
                        type="number"
                        min={v.min}
                        max={v.max}
                        step={v.step}
                        value={val}
                        placeholder={beforeIsProvided ? String(beforeVal) : "—"}
                        onChange={(e) => handleChange(v.key, e.target.value)}
                        className={`w-full rounded border px-2 py-1 bg-[#020712] text-xs font-mono font-bold text-center focus:outline-none focus:border-sky-400 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${
                          isChanged ? "border-sky-500 text-sky-300 bg-sky-950/40" : "border-[#1e3a5f] text-white"
                        }`}
                      />
                      <span className="text-[9.5px] font-mono text-[var(--text-muted)] shrink-0">{v.unit}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2.5 pt-0.5">
            <button
              onClick={handleReset}
              className="py-2 px-3 rounded-lg text-xs font-mono border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)] bg-[var(--bg-panel)] transition-all"
            >
              Reset
            </button>
            <button
              onClick={handleRun}
              disabled={loading}
              className="flex-1 py-2 px-4 rounded-lg text-xs font-mono font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
                boxShadow: loading ? "none" : "0 0 14px rgba(59,130,246,0.3)",
              }}
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Running…
                </>
              ) : (
                <>
                  <span>🚀 Run Scenario Simulation</span>
                  {changedCount > 0 && (
                    <span className="text-[10px] bg-white/20 px-1.5 py-0.2 rounded font-mono">
                      {changedCount} change{changedCount > 1 ? "s" : ""}
                    </span>
                  )}
                </>
              )}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-red-300 font-mono">
              ⚠ {error}
              {(error.toLowerCase().includes("fetch") ||
                error.toLowerCase().includes("network") ||
                error.toLowerCase().includes("failed to connect")) && (
                <p className="text-[10px] mt-1 text-red-400/70">Is the backend running on port 8000?</p>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT: Environment & Active Constraints (Matches Left Height Exactly) ── */}
        <div className="lg:col-span-6 flex flex-col justify-between space-y-3">
          {/* Active Flight Envelope & Mission Constraints Monitor */}
          <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#040c1a] p-3.5 space-y-2.5 shadow-lg flex-1">
            <div className="flex items-center justify-between border-b border-[#1e3a5f]/40 pb-2">
              <span className="text-[10px] font-mono font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>📡</span> Active Flight Envelope & Constraints
              </span>
              <span className={`text-[9px] font-mono flex items-center gap-1 ${
                isNonAerospace && !afterValues.mission_duration_days && !afterValues.solar_power_pct
                  ? "text-amber-400"
                  : "text-emerald-400"
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  isNonAerospace && !afterValues.mission_duration_days && !afterValues.solar_power_pct
                    ? "bg-amber-400"
                    : "bg-emerald-400 animate-pulse"
                }`} />
                {isNonAerospace && !afterValues.mission_duration_days && !afterValues.solar_power_pct
                  ? "UNSPECIFIED CONTEXT"
                  : "TELEMETRY SYNCED"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs font-mono">
              <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2.5">
                <div className="text-[8.5px] text-[var(--text-muted)] uppercase">Mission Class</div>
                <div className="text-[11px] font-bold text-white mt-0.5 truncate">
                  {afterValues.mission_duration_days || beforeValues.mission_duration_days
                    ? (Number(afterValues.mission_duration_days || beforeValues.mission_duration_days) > 365
                        ? "Long-Duration Deep Space"
                        : "Short-Stay Exploration")
                    : (isNonAerospace ? "Undefined (Non-Aerospace)" : "Planned Exploration")}
                </div>
                <div className="text-[8.5px] text-sky-400 mt-0.5">
                  Span: {afterValues.mission_duration_days || beforeValues.mission_duration_days ? `${afterValues.mission_duration_days || beforeValues.mission_duration_days} days` : "Unspecified"}
                </div>
              </div>

              <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2.5">
                <div className="text-[8.5px] text-[var(--text-muted)] uppercase">Power Margin</div>
                <div className="text-[11px] font-bold text-amber-300 mt-0.5 truncate">
                  {afterValues.solar_power_pct !== "" && afterValues.daily_power_consumption_kwh !== ""
                    ? `${(((Number(afterValues.solar_power_pct || 100) / 100) * Number(afterValues.battery_capacity_kwh || 120)) / Math.max(1, Number(afterValues.daily_power_consumption_kwh || 35))).toFixed(2)}x Coverage`
                    : (isNonAerospace && !afterValues.battery_capacity_kwh ? "Unspecified" : "1.00x Baseline")}
                </div>
                <div className="text-[8.5px] text-[var(--text-muted)] mt-0.5">
                  Draw: {afterValues.daily_power_consumption_kwh || (isNonAerospace ? "Unspecified" : "35 kWh/day")}
                </div>
              </div>

              <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2.5">
                <div className="text-[8.5px] text-[var(--text-muted)] uppercase">Comm Latency Window</div>
                <div className="text-[11px] font-bold text-purple-300 mt-0.5 truncate">
                  {afterValues.communication_delay_min || beforeValues.communication_delay_min
                    ? `${afterValues.communication_delay_min || beforeValues.communication_delay_min} min 1-way`
                    : (isNonAerospace ? "Unspecified" : "10 min 1-way")}
                </div>
                <div className="text-[8.5px] text-[var(--text-muted)] mt-0.5">
                  {afterValues.communication_delay_min || beforeValues.communication_delay_min
                    ? `RT: ${((afterValues.communication_delay_min || beforeValues.communication_delay_min) as number) * 2} min delay`
                    : "No baseline latency"}
                </div>
              </div>

              <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2.5">
                <div className="text-[8.5px] text-[var(--text-muted)] uppercase">ECLSS & ISRU Reserves</div>
                <div className="text-[11px] font-bold text-emerald-300 mt-0.5 truncate">
                  {afterValues.resource_availability_pct || beforeValues.resource_availability_pct
                    ? `${afterValues.resource_availability_pct || beforeValues.resource_availability_pct}% Capacity`
                    : (isNonAerospace ? "Unspecified" : "100% Capacity")}
                </div>
                <div className="text-[8.5px] text-emerald-400 mt-0.5">
                  {afterValues.resource_availability_pct || beforeValues.resource_availability_pct ? "Closed-loop verified" : (isNonAerospace ? "No life support data" : "Nominal")}
                </div>
              </div>
            </div>
          </div>

          {/* Environmental & Planetary Telemetry (Right Card) */}
          <div className="rounded-xl border border-[#1e3a5f]/70 bg-[#040c1a] p-3.5 space-y-2 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#1e3a5f]/40 pb-2">
              <span className="text-[10px] font-mono font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🪐</span> Planetary Environment & Life-Support Burn
              </span>
              <span className="text-[9px] font-mono text-[var(--accent-glow)] px-2 py-0.5 rounded border border-[#1e3a5f] bg-[#020712] truncate max-w-[240px]">
                {activeEnvironment.destination}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
              <div className="rounded border border-[#1e3a5f]/30 bg-[#020712] p-2">
                <div className="text-[8.5px] text-[var(--text-muted)]">Solar Flux</div>
                <div className="text-xs font-bold text-sky-300 mt-0.5">
                  {activeEnvironment.solar_flux_w_m2.toLocaleString()} W/m²
                </div>
                <div className="text-[8px] text-[var(--text-muted)] mt-0.5">
                  {activeEnvironment.solar_flux_pct_of_earth}% of Earth
                </div>
              </div>

              <div className="rounded border border-[#1e3a5f]/30 bg-[#020712] p-2">
                <div className="text-[8.5px] text-[var(--text-muted)]">Day / Night Cycle</div>
                <div className="text-xs font-bold text-white mt-0.5 truncate">
                  {activeEnvironment.day_night_cycle_hours}
                </div>
                <div className="text-[8px] text-[var(--text-muted)] mt-0.5 truncate">
                  {activeEnvironment.max_eclipse_hours}
                </div>
              </div>

              <div className="rounded border border-[#1e3a5f]/30 bg-[#020712] p-2">
                <div className="text-[8.5px] text-[var(--text-muted)]">ECLSS Water Burn</div>
                <div className="text-xs font-bold text-emerald-300 mt-0.5">
                  {activeEnvironment.daily_water_burn_kg} kg/day
                </div>
                <div className="text-[8px] text-emerald-400/80 mt-0.5">
                  Crew of {activeEnvironment.crew_size} (NASA-STD-3001)
                </div>
              </div>

              <div className="rounded border border-[#1e3a5f]/30 bg-[#020712] p-2">
                <div className="text-[8.5px] text-[var(--text-muted)]">Cumulative Radiation</div>
                <div
                  className={`text-xs font-bold mt-0.5 ${
                    activeEnvironment.estimated_radiation_msv > 600
                      ? "text-rose-400"
                      : activeEnvironment.estimated_radiation_msv > 300
                      ? "text-amber-300"
                      : "text-emerald-300"
                  }`}
                >
                  {activeEnvironment.estimated_radiation_msv} mSv
                </div>
                <div className="text-[8px] text-[var(--text-muted)] mt-0.5">
                  {activeEnvironment.career_limit_pct}% of 600 mSv limit
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── BOTTOM: SIMULATION RESULTS & MULTI-ROW INTELLIGENCE GRID ── */}
      {result && (
        <div className="space-y-4 pt-2 animate-fadeIn">
          {/* Row 1: Mission Readiness Delta & Planning Concerns (2 Balanced Columns) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Readiness Delta */}
            <div className="lg:col-span-6 rounded-xl border border-[#1e3a5f] bg-[#050f20] p-4 shadow-lg flex flex-col justify-between">
              <div className="flex items-center justify-between pb-3 border-b border-[#1e3a5f]/60">
                <div>
                  <span className="text-[9.5px] font-mono font-semibold tracking-widest text-sky-400 uppercase block">
                    Simulation Impact
                  </span>
                  <h2 className="text-sm font-bold text-white font-mono flex items-center gap-1.5">
                    <span>📊</span> Mission Readiness Delta
                  </h2>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Before</div>
                    <div className="text-base font-mono font-bold text-slate-300">
                      {result.readiness?.score_before ?? 80}%
                    </div>
                  </div>
                  <div className="text-[var(--text-muted)] text-sm font-mono">→</div>
                  <div className="text-left">
                    <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Simulated</div>
                    <div className="text-lg font-mono font-black text-white flex items-center gap-1.5">
                      <span>{result.readiness?.score_after ?? 80}%</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded font-bold font-mono ${
                          (result.readiness?.delta ?? 0) >= 0
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                            : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                        }`}
                      >
                        {(result.readiness?.delta ?? 0) >= 0 ? "▲ +" : "▼ "}
                        {result.readiness?.delta ?? 0}%
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Subsystem Readiness Bars */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-3">
                {Object.entries(result.readiness?.subsystem_scores_after || {}).map(([subName, score]) => {
                  const beforeScore = result.readiness?.subsystem_scores_before?.[subName] ?? score;
                  const subDelta = score - beforeScore;
                  return (
                    <div key={subName} className="rounded-lg border border-[#1e3a5f]/40 bg-[#030914] p-2">
                      <div className="text-[9.5px] font-mono text-[var(--text-muted)] truncate mb-0.5" title={subName}>
                        {subName}
                      </div>
                      <div className="flex items-center justify-between font-mono mb-1">
                        <span className="text-xs font-bold text-white">{score}%</span>
                        {subDelta !== 0 && (
                          <span className={`text-[8.5px] font-semibold ${subDelta > 0 ? "text-emerald-400" : "text-rose-400"}`}>
                            {subDelta > 0 ? "+" : ""}{subDelta}%
                          </span>
                        )}
                      </div>
                      <div className="h-1 rounded-full bg-[#102038] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${score}%`,
                            backgroundColor: score >= 80 ? "#10b981" : score >= 60 ? "#06b6d4" : score >= 40 ? "#f59e0b" : "#ef4444",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Planning Concerns Matrix */}
            <div className="lg:col-span-6 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden flex flex-col justify-between">
              <div className="px-4 py-2.5 border-b border-[var(--border)] flex items-center justify-between bg-[#040c1a]">
                <h2 className="text-xs font-bold text-white uppercase tracking-widest font-mono flex items-center gap-1.5">
                  <span>⚠️</span> Planning Concerns Matrix
                </h2>
                <span className="text-[9.5px] font-semibold text-[var(--text-muted)] uppercase tracking-widest font-mono">
                  Risk Before → After
                </span>
              </div>

              <div className="divide-y divide-[var(--border)]">
                {Object.entries(CONCERN_LABELS).map(([key, label]) => {
                  const before = result.concerns_before[key];
                  const after = result.concerns_after[key];
                  const levelChanged = before.level !== after.level;
                  return (
                    <div
                      key={key}
                      className={`px-4 py-2 flex items-center justify-between gap-2 ${levelChanged ? "bg-amber-500/5" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-[var(--text-primary)] font-mono">
                          {label}
                        </span>
                        {levelChanged && (
                          <span className="text-[8.5px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                            changed
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <ConcernBadge level={before.level} />
                        <ConcernArrow before={before.level} after={after.level} />
                        <ConcernBadge level={after.level} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Row 2: Variable Diffs & Countermeasures / Technical Diagnostics (2 Balanced Columns) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
            {/* Changed Variables Diff & Cascading Impacts */}
            <div className="lg:col-span-6 space-y-3 flex flex-col justify-between">
              {result.changes.some((c) => c.changed) ? (
                <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden flex-1">
                  <div className="px-4 py-2 border-b border-[var(--border)] bg-[#040c1a]">
                    <h2 className="text-[10px] font-bold text-sky-300 uppercase tracking-widest font-mono">
                      Changed Variables Diff
                    </h2>
                  </div>
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-[var(--border)] text-[9px] text-[var(--text-muted)] uppercase">
                        <th className="px-3.5 py-1.5 text-left">Variable</th>
                        <th className="px-3.5 py-1.5 text-left">Before</th>
                        <th className="px-3.5 py-1.5 text-left">After</th>
                        <th className="px-3.5 py-1.5 text-left">Δ</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {result.changes
                        .filter((c) => c.changed)
                        .map((c) => {
                          const delta = c.after - c.before;
                          return (
                            <tr key={c.key}>
                              <td className="px-3.5 py-2 text-white font-medium">{c.label}</td>
                              <td className="px-3.5 py-2 text-[var(--text-muted)]">{c.before} {c.unit}</td>
                              <td className="px-3.5 py-2 text-white">{c.after} {c.unit}</td>
                              <td className={`px-3.5 py-2 font-semibold ${delta > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                                {delta > 0 ? "+" : ""}{delta.toFixed(Number.isInteger(delta) ? 0 : 1)} {c.unit}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-[#1e3a5f]/40 bg-[#040c1a] p-3 text-center flex-1 flex items-center justify-center">
                  <span className="text-xs font-mono text-[var(--text-muted)]">No baseline variance detected</span>
                </div>
              )}

              {/* Cascading effects if any */}
              {result.cascading_effects && result.cascading_effects.length > 0 && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-amber-300 uppercase">
                    <span>⚡</span> Cross-Subsystem Cascading Impacts ({result.cascading_effects.length})
                  </div>
                  <div className="space-y-1.5">
                    {result.cascading_effects.map((cascade, i) => (
                      <div key={i} className="rounded border border-amber-500/20 bg-[#030914] p-2 text-xs font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-white font-semibold">{cascade.source_subsystem} → {cascade.impacted_subsystem}</span>
                          <span className="text-[8.5px] px-1.5 py-0.2 rounded font-bold text-amber-300 bg-amber-500/20">{cascade.severity}</span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] mt-1">{cascade.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Aerospace Engineering Countermeasures & Technical Diagnostics */}
            <div className="lg:col-span-6 space-y-3 flex flex-col justify-between">
              {/* Technical Detail 2x2 */}
              <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#040c1a] overflow-hidden shadow-lg flex-1">
                <div className="px-3.5 py-2 border-b border-[#1e3a5f]/50 bg-[#020712] flex items-center justify-between">
                  <h2 className="text-[10px] font-bold text-sky-300 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <span>🔬</span> After-State Technical Diagnostics
                  </h2>
                  <span className="text-[9px] font-mono text-[var(--text-muted)]">
                    4 Subsystems
                  </span>
                </div>
                <div className="p-2.5 grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {Object.entries(CONCERN_LABELS).map(([key, label]) => {
                    const after = result.concerns_after[key];
                    return (
                      <div key={key} className="rounded-lg border border-[#1e3a5f]/40 bg-[#020712] p-2 flex flex-col justify-between gap-1 font-mono">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            {label}
                          </span>
                          <ConcernBadge level={after.level} />
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] leading-snug">
                          {after.reason}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Countermeasures if any */}
              {result.mitigations && result.mitigations.length > 0 && (
                <div className="rounded-xl border border-sky-500/30 bg-[#040e22] p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-sky-300 uppercase">
                    <span>🛡️</span> Aerospace Engineering Countermeasures
                  </div>
                  <div className="space-y-1.5">
                    {result.mitigations.map((m, i) => (
                      <div key={i} className="rounded border border-[#1e3a5f]/60 bg-[#020712] p-2 text-xs font-mono space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-white font-bold">{m.subsystem}</span>
                          <ConcernBadge level={m.concern_level} />
                        </div>
                        <ul className="space-y-0.5 pl-2 border-l border-sky-500/30 text-[10px] text-slate-300">
                          {m.recommendations.map((rec, rIdx) => (
                            <li key={rIdx}>• {rec}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Row 3: Full-Width AI Cognitive Synthesis Section */}
          <div className="pt-2">
            {insightsLoading && (
              <div className="rounded-xl border border-[var(--accent)]/30 bg-[#050f20] px-5 py-5 flex items-center gap-3 shadow-xl">
                <svg className="animate-spin h-5 w-5 text-sky-400 shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                </svg>
                <div>
                  <p className="text-sm font-mono font-bold text-white">
                    AI is synthesizing multi-subsystem scenario insights…
                  </p>
                  <p className="text-xs font-mono text-[var(--text-muted)] mt-0.5">Evaluating physical coupled effects and operational flight runway</p>
                </div>
              </div>
            )}
            {!insightsLoading && <AiInsightsPanel insightsRes={insightsRes} />}
          </div>
        </div>
      )}

      {/* ── No mission hint ── */}
      {!activeMissionId && (
        <div className="mt-6 flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-panel)] p-4 text-sm text-[var(--text-muted)]">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="6" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 4v3.5M7 9.5v.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          No mission linked. Results are still valid.{" "}
          <Link href="/missions/create" className="text-[var(--accent-glow)] hover:underline ml-1">
            Create a mission →
          </Link>
        </div>
      )}
    </div>
  );
}

function ScenarioLabPage() {
  return (
    <Suspense>
      <ScenarioContent />
    </Suspense>
  );
}

export default function ScenarioLabPageWrapper() {
  return (
    <RequireAuth>
      <ScenarioLabPage />
    </RequireAuth>
  );
}
