"use client";

/**
 * OrbitalMissionMap — Mission Digital Twin
 *
 * Full-screen cinematic mission-control workspace built entirely with
 * pure SVG + React (zero new dependencies).
 *
 * Preserves all existing:
 *  - Data mapping (extractedToNodes, factsToNodes, computePositions)
 *  - Causal engine (evalPower, evalResources, evalComm, evalDuration)
 *  - CAUSAL_EDGES deterministic rules
 *  - BFS impact propagation
 *  - Scenario Lab deep-link
 *  - All existing props interface
 */

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import Link from "next/link";
import type { DocumentFact, MissionExtracted, MissionPlan } from "@/lib/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type NodeStatus = "confirmed" | "extracted" | "needs_review" | "missing" | "risk";

interface GraphNode {
  id: string;
  label: string;
  kind: "mission" | "system" | "param";
  systemId?: string;
  status: NodeStatus;
  value?: string;
  unit?: string;
  numeric?: number | null;
  confidence?: number;
  sourceDoc?: string;
  sourcePage?: number | null;
  sourceText?: string;
  scenarioKey?: string;
  riskNote?: string;
}

interface GraphEdge {
  id: string;
  source: string;
  target: string;
  kind: "orbit" | "causal";
  label?: string;
  rule?: string;
  direction?: "up" | "down" | "neutral";
  strength?: number; // 0-1, used for line thickness
}

interface Vec2 { x: number; y: number }
type NodePositions = Record<string, Vec2>;

// ---------------------------------------------------------------------------
// Status palette — glass HUD aesthetic
// ---------------------------------------------------------------------------

const STATUS: Record<NodeStatus, {
  stroke: string; glow: string; fill: string; label: string;
  glassTop: string; glassBot: string; particle: string;
}> = {
  confirmed:    { stroke: "#10b981", glow: "rgba(16,185,129,0.5)",  fill: "rgba(16,185,129,0.07)",  label: "Confirmed",    glassTop: "rgba(16,185,129,0.18)",  glassBot: "rgba(16,185,129,0.04)",  particle: "#34d399" },
  extracted:    { stroke: "#3b82f6", glow: "rgba(59,130,246,0.5)",  fill: "rgba(59,130,246,0.07)",  label: "Extracted",    glassTop: "rgba(59,130,246,0.18)",  glassBot: "rgba(59,130,246,0.04)",  particle: "#60a5fa" },
  needs_review: { stroke: "#f59e0b", glow: "rgba(245,158,11,0.5)",  fill: "rgba(245,158,11,0.07)",  label: "Needs Review", glassTop: "rgba(245,158,11,0.18)",  glassBot: "rgba(245,158,11,0.04)",  particle: "#fbbf24" },
  missing:      { stroke: "#334155", glow: "rgba(51,65,85,0.3)",    fill: "rgba(15,22,41,0.7)",     label: "Missing",      glassTop: "rgba(51,65,85,0.12)",    glassBot: "rgba(15,22,41,0.5)",     particle: "#475569" },
  risk:         { stroke: "#ef4444", glow: "rgba(239,68,68,0.55)",  fill: "rgba(239,68,68,0.07)",   label: "Risk",         glassTop: "rgba(239,68,68,0.2)",    glassBot: "rgba(239,68,68,0.04)",   particle: "#f87171" },
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const CX = 560;
const CY = 460;
const R1 = 190;
const R2 = 340;
const W  = 1120;
const H  = 920;
const MIN_ZOOM = 0.85;
const MAX_ZOOM = 2.2;

const SYSTEMS = [
  { id: "power",       label: "POWER",       angle: -90,  accent: "#3b82f6" },
  { id: "crew",        label: "CREW",        angle: -30,  accent: "#10b981" },
  { id: "comms",       label: "COMMS",       angle:  30,  accent: "#8b5cf6" },
  { id: "resources",   label: "RESOURCES",   angle:  90,  accent: "#f59e0b" },
  { id: "profile",     label: "PROFILE",     angle:  150, accent: "#06b6d4" },
  { id: "constraints", label: "CONSTRAINTS", angle:  210, accent: "#ef4444" },
] as const;

type SystemId = typeof SYSTEMS[number]["id"];

const FIELD_SYSTEM: Record<string, SystemId> = {
  solar_power_pct: "power", battery_capacity_kwh: "power",
  daily_power_consumption_kwh: "power", power_source: "power",
  mission_duration_days: "profile", duration: "profile",
  communication_delay_min: "comms", communication_delay: "comms",
  resource_availability_pct: "resources", known_resources: "resources",
  required_resources: "resources", crew_size: "crew", crew: "crew",
  destination: "profile", mission_type: "profile", objective: "profile",
  major_constraints: "constraints", missing_information: "constraints",
  planning_considerations: "constraints",
};

const CAUSAL_EDGES: Omit<GraphEdge, "id">[] = [
  { source: "mission_duration_days",       target: "resource_availability_pct",   kind: "causal", label: "Duration ↑ → Resources ↓",          rule: "Longer duration increases cumulative consumables burn, reducing effective reserve availability.", direction: "down", strength: 0.95 },
  { source: "mission_duration_days",       target: "daily_power_consumption_kwh", kind: "causal", label: "Duration ↑ → Power Demand ↑",       rule: "Extended operations compound continuous life-support, ECLSS and thermal control loads.", direction: "up", strength: 0.85 },
  { source: "mission_duration_days",       target: "constraints",                 kind: "causal", label: "Duration ↑ → Bio-Risk ↑",           rule: "Longer mission span increases cumulative ionizing radiation dose (mSv) and deep-space bio-hazards.", direction: "up", strength: 0.9 },
  { source: "daily_power_consumption_kwh", target: "battery_capacity_kwh",        kind: "causal", label: "Demand ↑ → Battery Buffer ↓",        rule: "Higher load draw reduces continuous battery autonomy hours relative to installed capacity.", direction: "down", strength: 0.85 },
  { source: "solar_power_pct",             target: "battery_capacity_kwh",        kind: "causal", label: "Solar ↓ → Daily Energy ↓",           rule: "Reduced photovoltaic generation degrades effective daily battery recharge buffer.", direction: "down", strength: 0.9 },
  { source: "solar_power_pct",             target: "power",                       kind: "causal", label: "Solar ↓ → Power Risk ↑",             rule: "Degraded solar array insolation increases power subsystem risk and forces load-shedding.", direction: "down", strength: 0.9 },
  { source: "communication_delay_min",     target: "comms",                       kind: "causal", label: "Delay ↑ → Comms Lag ↑",              rule: "Speed-of-light round-trip latency creates ground command & control turnaround delay.", direction: "up", strength: 0.85 },
  { source: "communication_delay_min",     target: "crew",                        kind: "causal", label: "Delay ↑ → Crew Autonomy ↑",          rule: "Latency > 3 min precludes real-time ground abort commands; requires Level-3 tactical crew autonomy.", direction: "up", strength: 0.75 },
  { source: "resource_availability_pct",   target: "constraints",                 kind: "causal", label: "Resources ↓ → Constraints ↑",        rule: "ECLSS consumable reserve depletion hardens mission planning constraints and survival margins.", direction: "up", strength: 0.8 },
  { source: "resource_availability_pct",   target: "resources",                   kind: "causal", label: "Resources ↓ → ECLSS Risk ↑",         rule: "Consumable buffer drop raises life-support subsystem risk.", direction: "down", strength: 0.9 },
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function deg(a: number) { return (a * Math.PI) / 180; }
function polar(cx: number, cy: number, r: number, a: number): Vec2 {
  return { x: cx + r * Math.cos(deg(a)), y: cy + r * Math.sin(deg(a)) };
}

function factStatus(state: DocumentFact["state"]): NodeStatus {
  if (state === "confirmed")    return "confirmed";
  if (state === "extracted")    return "extracted";
  if (state === "needs_review") return "needs_review";
  return "missing";
}

function extractedToNodes(extracted: MissionExtracted | null): GraphNode[] {
  if (!extracted) return [];
  const mapping: Array<{ key: keyof MissionExtracted; label: string; systemId: SystemId; scenarioKey?: string }> = [
    { key: "destination",     label: "Destination",     systemId: "profile"   },
    { key: "mission_type",    label: "Mission Type",    systemId: "profile"   },
    { key: "objective",       label: "Objective",       systemId: "profile"   },
    { key: "duration",        label: "Duration",        systemId: "profile",  scenarioKey: "mission_duration_days" },
    { key: "power_source",    label: "Power Source",    systemId: "power"     },
    { key: "known_resources", label: "Known Resources", systemId: "resources" },
  ];
  return mapping.map((m) => {
    const val = extracted[m.key];
    const strVal = val != null ? String(val).trim() : "";
    const hasVal = strVal !== "" && strVal.toLowerCase() !== "unknown";
    return {
      id: `ext_${m.key}`,
      label: m.label,
      kind: "param" as const,
      systemId: m.systemId,
      status: hasVal ? ("extracted" as NodeStatus) : ("missing" as NodeStatus),
      value: hasVal ? strVal : undefined,
      scenarioKey: m.scenarioKey,
    };
  });
}

function factsToNodes(facts: DocumentFact[]): GraphNode[] {
  const seen = new Set<string>();
  const nodes: GraphNode[] = [];
  for (const f of facts) {
    if (f.state === "not_specified") continue;
    const id = `fact_${f.field_key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const sysId: SystemId = (FIELD_SYSTEM[f.field_key] as SystemId) ?? "profile";
    nodes.push({
      id, label: f.label, kind: "param", systemId: sysId, status: factStatus(f.state),
      value: f.value ?? undefined, unit: f.unit ?? undefined, numeric: f.numeric_value ?? null,
      sourceDoc: f.document_id ?? undefined, sourcePage: f.page_number ?? null,
      sourceText: f.source_text ?? undefined,
      scenarioKey: f.field_key.includes("_pct") || f.field_key.includes("_kwh") ||
                   f.field_key.includes("_days") || f.field_key.includes("_min") ? f.field_key : undefined,
    });
  }
  return nodes;
}

function computePositions(paramNodes: GraphNode[]): NodePositions {
  const pos: NodePositions = { mission: { x: CX, y: CY } };

  // 1. Inner orbit for the 6 core subsystem nodes (R1 = 190px)
  for (const s of SYSTEMS) {
    pos[s.id] = polar(CX, CY, R1, s.angle);
  }

  // 2. Group parameters by system
  const bySystem: Record<string, GraphNode[]> = {};
  for (const n of paramNodes) {
    const sid = n.systemId ?? "profile";
    if (!bySystem[sid]) bySystem[sid] = [];
    bySystem[sid].push(n);
  }

  // 3. Place parameters in their system's dedicated angular sector on the outer orbit
  for (const s of SYSTEMS) {
    const group = bySystem[s.id] ?? [];
    if (group.length === 0) continue;

    if (group.length === 1) {
      pos[group[0].id] = polar(CX, CY, R2, s.angle);
    } else {
      // Sector width is 60 degrees. Limit maximum group span to 40 degrees to guarantee a 20 degree buffer between sectors
      const maxSpan = Math.min(42, (group.length - 1) * 16);
      const step = maxSpan / (group.length - 1);
      const startAngle = s.angle - maxSpan / 2;

      group.forEach((n, i) => {
        const angle = startAngle + i * step;
        // Radially stagger alternating nodes to give plenty of breathing room
        const radialOffset = group.length > 2 ? (i % 2 === 0 ? -24 : 28) : (i % 2 === 0 ? -16 : 20);
        const radius = R2 + radialOffset;
        pos[n.id] = polar(CX, CY, radius, angle);
      });
    }
  }

  // 4. Collision resolution relaxation pass (ensures no two nodes overlap)
  const nodeKeys = Object.keys(pos).filter((k) => k !== "mission");
  const minDistance = 86; // Minimum distance in pixels between any two node centers

  for (let iter = 0; iter < 45; iter++) {
    for (let i = 0; i < nodeKeys.length; i++) {
      for (let j = i + 1; j < nodeKeys.length; j++) {
        const idA = nodeKeys[i];
        const idB = nodeKeys[j];
        const pA = pos[idA];
        const pB = pos[idB];

        const dx = pB.x - pA.x;
        const dy = pB.y - pA.y;
        const dist = Math.hypot(dx, dy);

        if (dist < minDistance && dist > 0.001) {
          const overlap = (minDistance - dist) / 2;
          const nx = (dx / dist) * overlap;
          const ny = (dy / dist) * overlap;

          // Push parameter nodes freely while keeping core subsystem nodes stable
          const isSystemA = SYSTEMS.some((s) => s.id === idA);
          const isSystemB = SYSTEMS.some((s) => s.id === idB);

          if (!isSystemA) {
            pA.x -= nx * (isSystemB ? 1.6 : 1.0);
            pA.y -= ny * (isSystemB ? 1.6 : 1.0);
          }
          if (!isSystemB) {
            pB.x += nx * (isSystemA ? 1.6 : 1.0);
            pB.y += ny * (isSystemA ? 1.6 : 1.0);
          }
        }
      }
    }
  }

  return pos;
}

// ---------------------------------------------------------------------------
// Deterministic risk engine (mirrors backend exactly)
// ---------------------------------------------------------------------------

type ConcernLevel = "LOW" | "MEDIUM" | "HIGH" | "NOT_SPECIFIED";

function evalPower(solar: number, battery: number, consumption: number): ConcernLevel {
  const hasSolar = typeof solar === "number" && !isNaN(solar) && solar >= 0;
  const hasStorage = typeof battery === "number" && !isNaN(battery) && battery > 0 && typeof consumption === "number" && !isNaN(consumption) && consumption > 0;
  if (!hasSolar && !hasStorage) return "NOT_SPECIFIED";

  // Solar rating: 80%+ Green, 50-79% Yellow, <50% Red (0% is Critical Red)
  const solarRank: ConcernLevel = solar >= 80 ? "LOW" : solar >= 50 ? "MEDIUM" : "HIGH";
  if (!hasStorage) return solarRank;

  const ratio = ((solar / 100) * battery) / consumption;
  const storageRank: ConcernLevel = ratio >= 1.25 ? "LOW" : ratio >= 0.90 ? "MEDIUM" : "HIGH";
  const rank: Record<ConcernLevel, number> = { NOT_SPECIFIED: -1, LOW: 0, MEDIUM: 1, HIGH: 2 };
  return rank[solarRank] > rank[storageRank] ? solarRank : storageRank;
}

function evalResources(pct: number): ConcernLevel {
  if (pct === null || pct === undefined || isNaN(pct) || pct < 0) return "NOT_SPECIFIED";
  // 80% - 100%: Green (nominal safe margins)
  if (pct >= 80) return "LOW";
  // 50% - 79%: Yellow/Amber (degraded reserve, caution)
  if (pct >= 50) return "MEDIUM";
  // 0% - 49%: Red (critical depletion/fatal shortage, 0% is Critical Red)
  return "HIGH";
}

function evalComm(min: number): ConcernLevel {
  if (min === null || min === undefined || isNaN(min) || min < 0) return "NOT_SPECIFIED";
  // 0 - 1.5 min: Green (near real-time)
  if (min <= 1.5) return "LOW";
  // 1.5 - 15 min: Yellow (supervisory delay)
  if (min <= 15.0) return "MEDIUM";
  // > 15 min: Red (critical deep space latency)
  return "HIGH";
}

function evalDuration(days: number): ConcernLevel {
  if (days === null || days === undefined || isNaN(days) || days <= 0) return "NOT_SPECIFIED";
  // <= 90 days: Green (short expedition)
  if (days <= 90) return "LOW";
  // 91 - 365 days: Yellow (standard 1-year baseline)
  if (days <= 365) return "MEDIUM";
  // > 365 days: Red (multi-year high-strain mission)
  return "HIGH";
}

const CONCERN_COLOR: Record<ConcernLevel, string> = {
  LOW: "#10b981",
  MEDIUM: "#f59e0b",
  HIGH: "#ef4444",
  NOT_SPECIFIED: "#64748b",
};
const CONCERN_GLOW: Record<ConcernLevel, string> = {
  LOW: "rgba(16,185,129,0.4)",
  MEDIUM: "rgba(245,158,11,0.4)",
  HIGH: "rgba(239,68,68,0.5)",
  NOT_SPECIFIED: "rgba(100,116,139,0.3)",
};

// ---------------------------------------------------------------------------
// Static star field (seeded, stable across renders)
// ---------------------------------------------------------------------------

const STARS = Array.from({ length: 180 }, (_, i) => ({
  x: ((i * 43 + 17) % W),
  y: ((i * 67 + 11) % H),
  r: i % 9 === 0 ? 1.4 : i % 4 === 0 ? 0.9 : 0.5,
  o: 0.08 + (i % 6) * 0.05,
  twinkle: i % 7 === 0,
}));

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface OrbitalMissionMapProps {
  missionId: string | null;
  extracted: MissionExtracted | null;
  plan: MissionPlan | null;
  facts: DocumentFact[];
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function OrbitalMissionMap({
  missionId,
  extracted,
  plan,
  facts,
}: OrbitalMissionMapProps) {

  // ── Graph data ──────────────────────────────────────────────────────────────
  const paramNodes = useMemo<GraphNode[]>(() => {
    const fromExtracted = extractedToNodes(extracted);
    const fromFacts = factsToNodes(facts);
    const factIds = new Set(fromFacts.map((n) => n.scenarioKey).filter(Boolean));
    const filtered = fromExtracted.filter((n) => !n.scenarioKey || !factIds.has(n.scenarioKey));
    return [...filtered, ...fromFacts];
  }, [extracted, facts]);

  const allNodes = useMemo<GraphNode[]>(() => {
    const systemNodes: GraphNode[] = SYSTEMS.map((s) => ({
      id: s.id, label: s.label, kind: "system" as const, status: "extracted" as NodeStatus,
    }));
    return [
      { id: "mission", label: "MISSION", kind: "mission" as const, status: "confirmed" as NodeStatus,
        value: extracted?.mission_type || plan?.mission_summary?.slice(0, 60) || undefined },
      ...systemNodes, ...paramNodes,
    ];
  }, [extracted, plan, paramNodes]);

  const positions = useMemo(() => computePositions(paramNodes), [paramNodes]);

  const edges = useMemo<GraphEdge[]>(() => {
    const result: GraphEdge[] = [];
    for (const s of SYSTEMS) result.push({ id: `e_m_${s.id}`, source: "mission", target: s.id, kind: "orbit" });
    for (const n of paramNodes) {
      const sId = n.systemId ?? "profile";
      result.push({ id: `e_${sId}_${n.id}`, source: sId, target: n.id, kind: "orbit" });
    }
    const nodeIds = new Set(allNodes.map((n) => n.id));
    for (const ce of CAUSAL_EDGES) {
      const srcNode = paramNodes.find((n) => n.scenarioKey === ce.source || n.id === ce.source);
      const tgtNode = paramNodes.find((n) => n.scenarioKey === ce.target || n.id === ce.target)
        ?? allNodes.find((n) => n.id === ce.target);
      if (srcNode && tgtNode && nodeIds.has(srcNode.id) && nodeIds.has(tgtNode.id)) {
        result.push({ ...ce, id: `causal_${ce.source}_${ce.target}`, source: srcNode.id, target: tgtNode.id });
      }
    }
    return result;
  }, [allNodes, paramNodes]);

  // ── View state ───────────────────────────────────────────────────────────────
  const [selected, setSelected]           = useState<string | null>(null);
  const [hovered,  setHovered]            = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge]   = useState<GraphEdge | null>(null);
  const [focusSystem,  setFocusSystem]    = useState<string | null>(null);
  const [searchQuery,  setSearchQuery]    = useState("");
  const [isFullscreen, setIsFullscreen]   = useState(false);
  const [doubleClickSys, setDoubleClickSys] = useState<string | null>(null); // focused system view
  const [impactTrace,  setImpactTrace]    = useState(false); // step-by-step trace mode

  // Pan + zoom
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef       = useRef<SVGSVGElement>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const dragging = useRef<{ startX: number; startY: number; tx: number; ty: number } | null>(null);

  // Node dragging
  const [nodePositions, setNodePositions] = useState<NodePositions>(positions);
  const nodeDragging = useRef<{ id: string; ox: number; oy: number; mx: number; my: number; moved: boolean } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // Sync layout when computed positions change
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNodePositions(positions);
  }, [positions]);

  const pos = useCallback(
    (id: string): Vec2 => nodePositions[id] ?? positions[id] ?? { x: CX, y: CY },
    [nodePositions, positions],
  );

  // ── Simulation state ─────────────────────────────────────────────────────────
  const [simValues, setSimValues] = useState<Record<string, number>>({});
  const [simActive, setSimActive] = useState(false);
  const [activeParticles, setActiveParticles] = useState<string[]>([]); // edge ids with travelling particles

  // Impact trace step state
  const [traceStep, setTraceStep]   = useState(0);
  const [traceChain, setTraceChain] = useState<string[]>([]); // ordered node ids in impact path

  // ── Reactive Derived Simulation State ─────────────────────────────────────────
  const derivedTelemetry = useMemo(() => {
    const getBase = (key: string, def = 0): number =>
      paramNodes.find((n) => n.scenarioKey === key)?.numeric ?? def;

    const baseDuration = getBase("mission_duration_days", 0);
    const baseSolar = getBase("solar_power_pct", 0);
    const baseBattery = getBase("battery_capacity_kwh", 0);
    const baseConsumption = getBase("daily_power_consumption_kwh", 0);
    const baseComm = getBase("communication_delay_min", 0);
    const baseResources = getBase("resource_availability_pct", 0);

    const hasSim = simActive && Object.keys(simValues).length > 0;

    // 1. Direct user overrides or fallback to baseline
    const simDuration = simValues["mission_duration_days"] ?? (baseDuration > 0 ? baseDuration : 0);
    const simSolar = simValues["solar_power_pct"] ?? (baseSolar > 0 ? baseSolar : 0);
    const simBattery = simValues["battery_capacity_kwh"] ?? (baseBattery > 0 ? baseBattery : 0);
    const simComm = simValues["communication_delay_min"] ?? (baseComm > 0 ? baseComm : 0);

    // 2. Reactively derive dependent variables if not explicitly overridden using non-linear physics models
    let simResources: number;
    let isResourcesDerived = false;
    if (simValues["resource_availability_pct"] !== undefined) {
      simResources = simValues["resource_availability_pct"];
    } else if (hasSim && baseResources > 0 && simDuration > 0 && baseDuration > 0 && simDuration !== baseDuration) {
      if (simDuration > baseDuration) {
        // Extended mission: Non-linear consumable depletion with ECLSS filter wear factor
        const durationRatio = simDuration / baseDuration;
        const wearPenalty = 1 + 0.14 * Math.pow(Math.max(0, durationRatio - 1), 1.25);
        const depletedPct = baseResources * Math.pow(1 / durationRatio, 1.15) * (1 / wearPenalty);
        simResources = Math.max(5, Math.min(100, Math.round(depletedPct)));
      } else {
        // Shorter mission: Non-linear consumable surplus buffer
        const surplusFactor = 1 + 0.35 * Math.pow(1 - (simDuration / baseDuration), 0.85);
        simResources = Math.min(100, Math.round(baseResources * surplusFactor));
      }
      isResourcesDerived = true;
    } else if (hasSim && baseResources > 0 && simSolar > 0 && simSolar < 75) {
      // Solar drop: Sigmoidal recycling efficiency reduction as power is load-shed from water recovery & Sabatier reactors
      const recyclingEfficiency = 1 / (1 + Math.exp(-0.09 * (simSolar - 48)));
      simResources = Math.max(8, Math.min(100, Math.round(baseResources * (0.25 + 0.75 * recyclingEfficiency))));
      isResourcesDerived = true;
    } else {
      simResources = baseResources;
    }

    let simConsumption: number;
    let isConsumptionDerived = false;
    if (simValues["daily_power_consumption_kwh"] !== undefined) {
      simConsumption = simValues["daily_power_consumption_kwh"];
    } else if (hasSim && baseConsumption > 0 && simDuration > 0 && baseDuration > 0 && simDuration !== baseDuration) {
      if (simDuration > baseDuration) {
        // Non-linear thermal radiator coating degradation and battery heating load
        const durationRatio = (simDuration - baseDuration) / baseDuration;
        const addedThermalLoad = 0.24 * Math.pow(durationRatio, 1.35);
        simConsumption = Math.round(baseConsumption * (1 + addedThermalLoad));
      } else {
        // Shorter mission requires less margin/maintenance overhead
        const savingRatio = (baseDuration - simDuration) / baseDuration;
        simConsumption = Math.max(Math.round(baseConsumption * 0.8), Math.round(baseConsumption * (1 - 0.15 * savingRatio)));
      }
      isConsumptionDerived = true;
    } else {
      simConsumption = baseConsumption;
    }

    return {
      duration: { val: simDuration, isOverridden: simValues["mission_duration_days"] !== undefined, isDerived: false, base: baseDuration },
      solar: { val: simSolar, isOverridden: simValues["solar_power_pct"] !== undefined, isDerived: false, base: baseSolar },
      battery: { val: simBattery, isOverridden: simValues["battery_capacity_kwh"] !== undefined, isDerived: false, base: baseBattery },
      consumption: { val: simConsumption, isOverridden: simValues["daily_power_consumption_kwh"] !== undefined, isDerived: isConsumptionDerived, base: baseConsumption },
      comm: { val: simComm, isOverridden: simValues["communication_delay_min"] !== undefined, isDerived: false, base: baseComm },
      resources: { val: simResources, isOverridden: simValues["resource_availability_pct"] !== undefined, isDerived: isResourcesDerived, base: baseResources },
    };
  }, [simActive, simValues, paramNodes]);

  // ── Derived: impacted nodes via BFS ──────────────────────────────────────────
  const impactedNodes = useMemo<Set<string>>(() => {
    if (!simActive || Object.keys(simValues).length === 0) return new Set();
    const affected = new Set<string>();

    // Add all nodes with active direct or derived overrides
    for (const n of paramNodes) {
      if (n.scenarioKey === "mission_duration_days" && derivedTelemetry.duration.isOverridden) affected.add(n.id);
      if (n.scenarioKey === "solar_power_pct" && derivedTelemetry.solar.isOverridden) affected.add(n.id);
      if (n.scenarioKey === "resource_availability_pct" && (derivedTelemetry.resources.isOverridden || derivedTelemetry.resources.isDerived)) affected.add(n.id);
      if (n.scenarioKey === "daily_power_consumption_kwh" && (derivedTelemetry.consumption.isOverridden || derivedTelemetry.consumption.isDerived)) affected.add(n.id);
      if (n.scenarioKey === "battery_capacity_kwh" && derivedTelemetry.battery.isOverridden) affected.add(n.id);
      if (n.scenarioKey === "communication_delay_min" && derivedTelemetry.comm.isOverridden) affected.add(n.id);
    }

    // Propagate BFS along causal edges to downstream nodes and subsystems
    const causal = edges.filter((e) => e.kind === "causal");
    const queue = [...affected];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of causal) {
        if (e.source === cur && !affected.has(e.target)) {
          affected.add(e.target);
          queue.push(e.target);
        }
      }
    }
    return affected;
  }, [simActive, simValues, paramNodes, edges, derivedTelemetry]);

  // ── Risk levels ───────────────────────────────────────────────────────────────
  const simRisk = useMemo(() => {
    if (!simActive) return {} as Record<string, ConcernLevel>;
    return {
      power:         evalPower(derivedTelemetry.solar.val, derivedTelemetry.battery.val, derivedTelemetry.consumption.val),
      resources:     evalResources(derivedTelemetry.resources.val),
      communication: evalComm(derivedTelemetry.comm.val),
      duration:      evalDuration(derivedTelemetry.duration.val),
    };
  }, [simActive, derivedTelemetry]);

  // Baseline risk (before sim)
  const baseRisk = useMemo(() => {
    const get = (key: string, def = 0) => paramNodes.find((n) => n.scenarioKey === key)?.numeric ?? def;
    return {
      power:         evalPower(get("solar_power_pct", 0), get("battery_capacity_kwh", 0), get("daily_power_consumption_kwh", 0)),
      resources:     evalResources(get("resource_availability_pct", 0)),
      communication: evalComm(get("communication_delay_min", 0)),
      duration:      evalDuration(get("mission_duration_days", 0)),
    };
  }, [paramNodes]);

  // Dynamic system risks (reactive in real-time)
  const liveSystemRisks = useMemo<Record<string, ConcernLevel>>(() => {
    const powerRisk = simActive ? simRisk.power : baseRisk.power;
    const resourcesRisk = simActive ? simRisk.resources : baseRisk.resources;
    const commRisk = simActive ? simRisk.communication : baseRisk.communication;
    const durationRisk = simActive ? simRisk.duration : baseRisk.duration;

    // Constraints risk is worst-case of active risks
    const rank: Record<ConcernLevel, number> = { NOT_SPECIFIED: -1, LOW: 0, MEDIUM: 1, HIGH: 2 };
    const allActive = [powerRisk, resourcesRisk, commRisk, durationRisk].filter(r => r !== "NOT_SPECIFIED");
    let worstRisk: ConcernLevel = "NOT_SPECIFIED";
    for (const r of allActive) {
      if (rank[r] > rank[worstRisk]) worstRisk = r;
    }

    return {
      power: powerRisk,
      resources: resourcesRisk,
      comms: commRisk,
      profile: durationRisk,
      constraints: worstRisk !== "NOT_SPECIFIED" ? worstRisk : "LOW",
      crew: commRisk === "HIGH" ? "MEDIUM" : "LOW",
    };
  }, [simActive, simRisk, baseRisk]);

  // ── Highlighted nodes (hover / focus / search) ───────────────────────────────
  const highlightedNodes = useMemo<Set<string> | null>(() => {
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matched = new Set<string>();
      for (const n of allNodes) {
        const valStr = n.value != null ? String(n.value).toLowerCase() : "";
        if (n.label.toLowerCase().includes(q) || valStr.includes(q)) {
          matched.add(n.id);
          // also highlight connected
          for (const e of edges) {
            if (e.source === n.id) matched.add(e.target);
            if (e.target === n.id) matched.add(e.source);
          }
        }
      }
      return matched.size ? matched : null;
    }
    if (doubleClickSys) {
      const group = new Set<string>(["mission", doubleClickSys]);
      for (const n of paramNodes) { if (n.systemId === doubleClickSys) group.add(n.id); }
      return group;
    }
    if (focusSystem) {
      const group = new Set<string>(["mission", focusSystem]);
      for (const n of paramNodes) { if (n.systemId === focusSystem) group.add(n.id); }
      return group;
    }
    if (hovered) {
      const connected = new Set<string>([hovered]);
      for (const e of edges) {
        if (e.source === hovered) connected.add(e.target);
        if (e.target === hovered) connected.add(e.source);
      }
      return connected;
    }
    return null;
  }, [searchQuery, hovered, focusSystem, doubleClickSys, edges, allNodes, paramNodes]);

  const selectedNode = allNodes.find((n) => n.id === selected) ?? null;

  // ── Scenario Lab URL ─────────────────────────────────────────────────────────
  const scenarioLabUrl = useMemo(() => {
    if (!missionId) return `/scenario-lab`;
    const p = new URLSearchParams({ missionId });
    for (const [k, v] of Object.entries(simValues)) p.set(k, String(v));
    return `/scenario-lab?${p.toString()}`;
  }, [missionId, simValues]);

  // ── Event handlers ────────────────────────────────────────────────────────────
  const handleSvgMouseDown = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if ((e.target as Element).closest(".node-group")) return;
    dragging.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y };
    setIsPanning(true);
  }, [transform]);

  const handleSvgMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    if (nodeDragging.current) {
      const { id, ox, oy, mx, my } = nodeDragging.current;
      const dx = (e.clientX - mx) / transform.scale;
      const dy = (e.clientY - my) / transform.scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) nodeDragging.current.moved = true;
      
      const rawX = ox + dx;
      const rawY = oy + dy;
      const orig = positions[id] ?? { x: CX, y: CY };

      // Clamped tether: maximum 85px from home coordinate with elastic ceiling
      const MAX_OFFSET = 85;
      const dist = Math.hypot(rawX - orig.x, rawY - orig.y);
      let targetX = rawX;
      let targetY = rawY;

      if (dist > MAX_OFFSET) {
        const angle = Math.atan2(rawY - orig.y, rawX - orig.x);
        const overflow = dist - MAX_OFFSET;
        const dampened = MAX_OFFSET + Math.atan(overflow / 35) * 16;
        targetX = orig.x + Math.cos(angle) * dampened;
        targetY = orig.y + Math.sin(angle) * dampened;
      }

      // Visible canvas bounds clamp
      targetX = Math.max(60, Math.min(W - 60, targetX));
      targetY = Math.max(60, Math.min(H - 60, targetY));

      setNodePositions((prev) => ({ ...prev, [id]: { x: targetX, y: targetY } }));
      return;
    }
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.startX;
    const dy = e.clientY - dragging.current.startY;
    // Clamped canvas panning
    const newTx = Math.max(-260, Math.min(260, dragging.current!.tx + dx));
    const newTy = Math.max(-200, Math.min(200, dragging.current!.ty + dy));
    setTransform((t) => ({ ...t, x: newTx, y: newTy }));
  }, [transform.scale, positions]);

  const handleSvgMouseUp = useCallback(() => {
    dragging.current = null;
    nodeDragging.current = null;
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.06 : 0.94;
    // Clamped zoom range
    setTransform((t) => ({ ...t, scale: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, t.scale * factor)) }));
  }, []);

  const resetLayout = useCallback(() => {
    setNodePositions(positions);
    setTransform({ x: 0, y: 0, scale: 1 });
    setFocusSystem(null);
    setDoubleClickSys(null);
  }, [positions]);

  const handleNodeMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    const p = pos(id);
    nodeDragging.current = { id, ox: p.x, oy: p.y, mx: e.clientX, my: e.clientY, moved: false };
  }, [pos]);

  const handleNodeClick = useCallback((id: string) => {
    if (nodeDragging.current?.moved) return;
    setSelected((s) => s === id ? null : id);
    setSelectedEdge(null);
  }, []);

  const handleNodeDblClick = useCallback((id: string) => {
    const node = allNodes.find((n) => n.id === id);
    if (node?.kind === "system") setDoubleClickSys((s) => s === id ? null : id);
  }, [allNodes]);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelectedEdge((e) => e?.id === edge.id ? null : edge);
    setSelected(null);
  }, []);

  const handleSimChange = useCallback((key: string, val: number) => {
    setSimValues((prev) => ({ ...prev, [key]: val }));
    setSimActive(true);
    // Fire travelling particles on all edges touching this key
    const touchedEdges = edges.filter(
      (e) => e.kind === "causal" && (e.source.includes(key) || e.target.includes(key)),
    ).map((e) => e.id);
    setActiveParticles(touchedEdges);
    setTimeout(() => setActiveParticles([]), 2000);
  }, [edges]);

  const triggerPreset = useCallback((preset: "solar_drop" | "duration_surge" | "comm_delay" | "reset") => {
    if (preset === "reset") {
      setSimValues({});
      setSimActive(false);
      setImpactTrace(false);
      setTraceStep(0);
      setTraceChain([]);
      return;
    }
    const newSim: Record<string, number> = {};
    if (preset === "solar_drop") {
      newSim["solar_power_pct"] = 55;
    } else if (preset === "duration_surge") {
      newSim["mission_duration_days"] = 720;
    } else if (preset === "comm_delay") {
      newSim["communication_delay_min"] = 35;
    }
    setSimValues(newSim);
    setSimActive(true);
    const causalIds = edges.filter((e) => e.kind === "causal").map((e) => e.id);
    setActiveParticles(causalIds);
    setTimeout(() => setActiveParticles([]), 2500);
  }, [edges]);

  const clearSim = useCallback(() => {
    setSimValues({});
    setSimActive(false);
    setImpactTrace(false);
    setTraceStep(0);
    setTraceChain([]);
  }, []);

  const focusOnSystem = useCallback((sysId: string | null) => {
    if (!sysId || focusSystem === sysId) {
      setFocusSystem(null);
      setDoubleClickSys(null);
      setTransform({ x: 0, y: 0, scale: 1 });
      return;
    }
    setFocusSystem(sysId);
    setDoubleClickSys(sysId);
    const sysPos = positions[sysId];
    if (sysPos) {
      const targetScale = 1.25;
      const tx = (CX - sysPos.x) * targetScale * 0.65;
      const ty = (CY - sysPos.y) * targetScale * 0.65;
      setTransform({
        x: Math.max(-180, Math.min(180, tx)),
        y: Math.max(-140, Math.min(140, ty)),
        scale: targetScale,
      });
    }
  }, [focusSystem, positions]);

  // Build impact trace chain from changed nodes → BFS order
  const buildTraceChain = useCallback(() => {
    const changedIds = paramNodes
      .filter((n) => n.scenarioKey && simValues[n.scenarioKey] !== undefined)
      .map((n) => n.id);
    const causal = edges.filter((e) => e.kind === "causal");
    const visited = new Set<string>();
    const chain: string[] = [...changedIds];
    changedIds.forEach((id) => visited.add(id));
    let qi = 0;
    while (qi < chain.length) {
      const cur = chain[qi++];
      for (const e of causal) {
        if (e.source === cur && !visited.has(e.target)) {
          visited.add(e.target);
          chain.push(e.target);
        }
      }
    }
    setTraceChain(chain);
    setTraceStep(0);
    setImpactTrace(true);
  }, [simValues, paramNodes, edges]);

  // Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  // Trace step keyboard navigation
  useEffect(() => {
    if (!impactTrace) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setTraceStep((s) => Math.min(s + 1, traceChain.length - 1));
      if (e.key === "ArrowLeft")  setTraceStep((s) => Math.max(s - 1, 0));
      if (e.key === "Escape")     { setImpactTrace(false); setTraceStep(0); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [impactTrace, traceChain.length]);

  // ── Render helpers ─────────────────────────────────────────────────────────────

  function getEdgePath(sx: number, sy: number, tx: number, ty: number, kind: GraphEdge["kind"]) {
    const mx = (sx + tx) / 2, my = (sy + ty) / 2;
    const dx = tx - sx, dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const curve = kind === "orbit" ? 18 : 38;
    const qx = mx - (dy / len) * curve;
    const qy = my + (dx / len) * curve;
    return `M${sx},${sy} Q${qx},${qy} ${tx},${ty}`;
  }

  function renderEdge(e: GraphEdge) {
    const s = pos(e.source), t = pos(e.target);
    if (!s || !t) return null;

    const isActive   = selectedEdge?.id === e.id;
    const isImpact   = simActive && (impactedNodes.has(e.target) || impactedNodes.has(e.source)) && e.kind === "causal";
    const isParticle = activeParticles.includes(e.id);
    const dimmed     = highlightedNodes && (!highlightedNodes.has(e.source) || !highlightedNodes.has(e.target));
    const inTrace    = impactTrace && e.kind === "causal" &&
      traceChain.slice(0, traceStep + 1).includes(e.source) &&
      traceChain.slice(0, traceStep + 1).includes(e.target);

    const path = getEdgePath(s.x, s.y, t.x, t.y, e.kind);

    const strength = e.strength ?? 0.7;
    let color  = e.kind === "orbit" ? "#1e3a5f" : "#3b82f6";
    let strokeW = e.kind === "orbit" ? 0.7 : 0.8 + strength * 1.2;
    let opacity = dimmed ? 0.04 : isActive ? 1 : isImpact ? 0.95 : inTrace ? 0.9 : e.kind === "causal" ? 0.45 : 0.2;

    // Determine edge specific risk level
    const srcNode = allNodes.find((n) => n.id === e.source);
    const tgtNode = allNodes.find((n) => n.id === e.target);

    const anyHigh = simRisk.duration === "HIGH" || simRisk.power === "HIGH" || simRisk.resources === "HIGH" || simRisk.communication === "HIGH";
    const anyMedium = simRisk.duration === "MEDIUM" || simRisk.power === "MEDIUM" || simRisk.resources === "MEDIUM" || simRisk.communication === "MEDIUM";
    
    let edgeRisk: ConcernLevel = anyHigh ? "HIGH" : anyMedium ? "MEDIUM" : "LOW";
    if (tgtNode?.scenarioKey === "resource_availability_pct" || srcNode?.scenarioKey === "resource_availability_pct" || tgtNode?.id === "resources" || srcNode?.id === "resources") {
      edgeRisk = simRisk.resources ?? edgeRisk;
    } else if (tgtNode?.scenarioKey === "mission_duration_days" || srcNode?.scenarioKey === "mission_duration_days" || tgtNode?.id === "profile" || srcNode?.id === "profile") {
      edgeRisk = simRisk.duration ?? edgeRisk;
    } else if (tgtNode?.scenarioKey === "daily_power_consumption_kwh" || tgtNode?.scenarioKey === "solar_power_pct" || tgtNode?.scenarioKey === "battery_capacity_kwh" || tgtNode?.id === "power" || srcNode?.id === "power") {
      edgeRisk = simRisk.power ?? edgeRisk;
    } else if (tgtNode?.scenarioKey === "communication_delay_min" || srcNode?.scenarioKey === "communication_delay_min" || tgtNode?.id === "comms" || srcNode?.id === "comms") {
      edgeRisk = simRisk.communication ?? edgeRisk;
    } else if (tgtNode?.id === "constraints" || srcNode?.id === "constraints") {
      edgeRisk = liveSystemRisks.constraints ?? edgeRisk;
    }

    const impactColor = edgeRisk === "HIGH" ? "#ef4444" : edgeRisk === "MEDIUM" ? "#f59e0b" : "#10b981";
    const markerId = edgeRisk === "HIGH" ? "arr-red" : edgeRisk === "MEDIUM" ? "arr-amber" : "arr-green";

    if (isImpact) { color = impactColor; strokeW = 1.8 + strength; }
    if (inTrace)  { color = "#f59e0b"; strokeW = 2.2; opacity = 1; }
    if (isActive) { color = "#60a5fa"; strokeW = 2.2; }

    return (
      <g
        key={e.id}
        onClick={() => e.kind === "causal" && handleEdgeClick(e)}
        style={{ cursor: e.kind === "causal" ? "pointer" : "default" }}
      >
        {/* Hit target (wider invisible stroke) */}
        <path d={path} fill="none" stroke="transparent" strokeWidth={14} />

        {/* Ambient glow underneath */}
        {(isImpact || isActive || inTrace) && (
          <path d={path} fill="none" stroke={color} strokeWidth={strokeW + 6} opacity={0.35} strokeLinecap="round" />
        )}

        {/* Main stroke */}
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeWidth={strokeW}
          strokeDasharray={e.kind === "causal" ? (isImpact || inTrace ? "6 4" : "4 5") : "2 6"}
          opacity={opacity}
          strokeLinecap="round"
          markerEnd={e.kind === "causal" ? `url(#${isActive || inTrace ? "arr-bright" : isImpact ? markerId : "arr-dim"})` : undefined}
        >
          {isImpact && (
            <animate attributeName="stroke-dashoffset" from="24" to="0" dur="1.2s" repeatCount="indefinite" />
          )}
        </path>

        {/* Live flowing energy particle on active causal edges */}
        {(isImpact || isParticle) && e.kind === "causal" && (
          <circle r={isParticle ? 4 : 3} fill={isParticle ? "#38bdf8" : impactColor} filter="url(#nodeGlow)">
            <animateMotion dur={isParticle ? "2s" : "2.8s"} repeatCount={isParticle ? 1 : "indefinite"} path={path} />
          </circle>
        )}

        {/* Ambient slow energy pulse on causal edges */}
        {!isImpact && e.kind === "causal" && (
          <circle r={2.2} fill={color} opacity={dimmed ? 0.05 : 0.65} filter="url(#nodeGlow)">
            <animateMotion dur="8s" repeatCount="indefinite" path={path} />
          </circle>
        )}

        {/* Impact label on causal edges when active */}
        {isActive && e.label && (() => {
          const mx2 = (s.x + t.x) / 2, my2 = (s.y + t.y) / 2;
          return (
            <g style={{ pointerEvents: "none", userSelect: "none" }}>
              <rect x={mx2 - 50} y={my2 - 18} width={100} height={16} rx={4} fill="rgba(6,11,24,0.92)" stroke="#3b82f6" strokeWidth={0.8} />
              <text x={mx2} y={my2 - 7} textAnchor="middle" fontSize={7.5} fontFamily="'Courier New',monospace"
                fill="#93c5fd" fontWeight="700">
                {e.label}
              </text>
            </g>
          );
        })()}
      </g>
    );
  }

// ---------------------------------------------------------------------------
// Node Geometries & SVG Vector Glyphs
// ---------------------------------------------------------------------------

function getNodeGeometry(node: GraphNode, w: number, h: number): {
  path: string;
  iconType: string;
} {
  const isMission = node.kind === "mission";
  const isSystem = node.kind === "system";
  const key = node.scenarioKey || node.id;

  if (isMission) {
    // Cybernetic Decagon / Octagon Command Core
    const c = 14;
    const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},${-h/2 + c} L ${w/2},${h/2 - c} L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},${h/2 - c} L ${-w/2},${-h/2 + c} Z`;
    return { path, iconType: "mission" };
  }

  if (isSystem) {
    if (node.id === "power") {
      // Hexagonal Energy Cell with Chamfered Side Rails
      const c = 14;
      const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},0 L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},0 Z`;
      return { path, iconType: "power" };
    }
    if (node.id === "resources") {
      // Bio-Life Support Canister (Cylinder with Upper & Lower Collars)
      const r = 12;
      const path = `M ${-w/2 + r},${-h/2} L ${w/2 - r},${-h/2} Q ${w/2},${-h/2} ${w/2},${-h/2 + r} L ${w/2},${h/2 - r} Q ${w/2},${h/2} ${w/2 - r},${h/2} L ${-w/2 + r},${h/2} Q ${-w/2},${h/2} ${-w/2},${h/2 - r} L ${-w/2},${-h/2 + r} Q ${-w/2},${-h/2} ${-w/2 + r},${-h/2} Z`;
      return { path, iconType: "resources" };
    }
    if (node.id === "constraints") {
      // Tactical Hazard Shield with Angled V-Bottom Point
      const path = `M ${-w/2 + 6},${-h/2} L ${w/2 - 6},${-h/2} L ${w/2},${-h/2 + 6} L ${w/2},${h/4} L 0,${h/2 + 3} L ${-w/2},${h/4} L ${-w/2},${-h/2 + 6} Z`;
      return { path, iconType: "constraints" };
    }
    if (node.id === "comms") {
      // Deep-Space Radar Dish / Antenna Hexagon
      const c = 14;
      const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},0 L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},0 Z`;
      return { path, iconType: "comms" };
    }
    if (node.id === "crew") {
      // Bio-Helmet Visor Dome
      const r = 14;
      const path = `M ${-w/2 + r},${-h/2} Q 0,${-h/2 - 4} ${w/2 - r},${-h/2} Q ${w/2},${-h/2} ${w/2},${-h/2 + r} L ${w/2 - 4},${h/2 - 6} Q ${w/2 - 6},${h/2} ${w/2 - 14},${h/2} L ${-w/2 + 14},${h/2} Q ${-w/2 + 6},${h/2} ${-w/2 + 4},${h/2 - 6} L ${-w/2},${-h/2 + r} Q ${-w/2},${-h/2} ${-w/2 + r},${-h/2} Z`;
      return { path, iconType: "crew" };
    }
    if (node.id === "profile") {
      // Orbital Trajectory Chevron Capsule
      const c = 9;
      const path = `M ${-w/2},${-h/2 + c} L ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},0 L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},${h/2 - c} Z`;
      return { path, iconType: "profile" };
    }
  }

  // Parameter Nodes
  if (key === "mission_duration_days" || key === "duration") {
    // Chronometer Diamond Pod
    const c = 9;
    const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},0 L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},0 Z`;
    return { path, iconType: "duration" };
  }
  if (key === "solar_power_pct") {
    // Solar Cell Hexagon
    const c = 7;
    const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},${-h/2 + c} L ${w/2},${h/2 - c} L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},${h/2 - c} L ${-w/2},${-h/2 + c} Z`;
    return { path, iconType: "solar" };
  }
  if (key === "battery_capacity_kwh") {
    // Battery Cylinder Pill
    const r = 8;
    const path = `M ${-w/2 + r},${-h/2} L ${w/2 - r},${-h/2} Q ${w/2},${-h/2} ${w/2},${-h/2 + r} L ${w/2},${h/2 - r} Q ${w/2},${h/2} ${w/2 - r},${h/2} L ${-w/2 + r},${h/2} Q ${-w/2},${h/2} ${-w/2},${h/2 - r} L ${-w/2},${-h/2 + r} Q ${-w/2},${-h/2} ${-w/2 + r},${-h/2} Z`;
    return { path, iconType: "battery" };
  }
  if (key === "daily_power_consumption_kwh") {
    // Power Load Meter
    const c = 7;
    const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},${-h/2 + c} L ${w/2},${h/2 - c} L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},${h/2 - c} L ${-w/2},${-h/2 + c} Z`;
    return { path, iconType: "consumption" };
  }
  if (key === "resource_availability_pct") {
    // Life-Support Fluid Capsule
    const r = 8;
    const path = `M ${-w/2 + r},${-h/2} L ${w/2 - r},${-h/2} Q ${w/2},${-h/2} ${w/2},${-h/2 + r} L ${w/2},${h/2 - r} Q ${w/2},${h/2} ${w/2 - r},${h/2} L ${-w/2 + r},${h/2} Q ${-w/2},${h/2} ${-w/2},${h/2 - r} L ${-w/2},${-h/2 + r} Q ${-w/2},${-h/2} ${-w/2 + r},${-h/2} Z`;
    return { path, iconType: "resources" };
  }
  if (key === "communication_delay_min") {
    // Comm RF Radio Chevron
    const c = 8;
    const path = `M ${-w/2},${-h/2 + c} L ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},${-h/2 + c} L ${w/2},${h/2 - c} L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},${h/2 - c} Z`;
    return { path, iconType: "comms" };
  }

  // Default Chamfered Tag Shape for facts/metadata
  const c = 6;
  const path = `M ${-w/2 + c},${-h/2} L ${w/2 - c},${-h/2} L ${w/2},${-h/2 + c} L ${w/2},${h/2 - c} L ${w/2 - c},${h/2} L ${-w/2 + c},${h/2} L ${-w/2},${h/2 - c} L ${-w/2},${-h/2 + c} Z`;
  return { path, iconType: "fact" };
}

function renderNodeGlyph(iconType: string, strokeColor: string) {
  switch (iconType) {
    case "mission":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <circle cx="0" cy="0" r="5" strokeWidth={1.4} />
          <circle cx="0" cy="0" r="2" fill={strokeColor} />
          <ellipse cx="0" cy="0" rx="9" ry="3" transform="rotate(-30)" strokeDasharray="1.5 1.5" opacity={0.8} />
        </g>
      );
    case "power":
      return (
        <g fill={strokeColor}>
          <polygon points="-1,-5 2,-5 -0.5,-0.5 3,-0.5 -1.5,5.5 -0.2,0.8 -3,0.8" />
        </g>
      );
    case "resources":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <path d="M0,-5 C2,-2 3,0.5 3,2.2 C3,3.8 1.7,5 0,5 C-1.7,5 -3,3.8 -3,2.2 C-3,0.5 -2,-2 0,-5 Z" fill={strokeColor} fillOpacity={0.4} />
        </g>
      );
    case "constraints":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <polygon points="0,-5 5,4 -5,4" strokeLinejoin="round" />
          <line x1="0" y1="-1.5" x2="0" y2="1" strokeWidth={1.4} />
          <circle cx="0" cy="2.8" r="0.6" fill={strokeColor} />
        </g>
      );
    case "comms":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <path d="M-4,-3 A5.5,5.5 0 0,1 4,-3" />
          <path d="M-2.5,-1 A3,3 0 0,1 2.5,-1" />
          <circle cx="0" cy="2.5" r="1.2" fill={strokeColor} />
          <line x1="0" y1="2.5" x2="0" y2="5" strokeWidth={1.2} />
        </g>
      );
    case "crew":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <circle cx="0" cy="-2.5" r="2.8" />
          <path d="M-4.5,4.5 C-4.5,1.5 -2,0 0,0 C2,0 4.5,1.5 4.5,4.5" />
        </g>
      );
    case "profile":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <path d="M-4,4 L0,-4 L4,4 L0,2 Z" fill={strokeColor} fillOpacity={0.4} />
        </g>
      );
    case "duration":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <circle cx="0" cy="0" r="4.5" />
          <polyline points="0,-2.8 0,0 2,1.2" />
          <line x1="-1.5" y1="-5.2" x2="1.5" y2="-5.2" />
        </g>
      );
    case "solar":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <circle cx="0" cy="0" r="2.2" fill={strokeColor} />
          <line x1="0" y1="-4.8" x2="0" y2="-3.2" />
          <line x1="0" y1="3.2" x2="0" y2="4.8" />
          <line x1="-4.8" y1="0" x2="-3.2" y2="0" />
          <line x1="3.2" y1="0" x2="4.8" y2="0" />
        </g>
      );
    case "battery":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.1}>
          <rect x="-3" y="-4.5" width="6" height="9" rx="1.2" />
          <line x1="-1.2" y1="-5.5" x2="1.2" y2="-5.5" strokeWidth={1.3} />
          <rect x="-2" y="-1" width="4" height="4" fill={strokeColor} fillOpacity={0.8} />
        </g>
      );
    case "consumption":
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.2}>
          <path d="M-4,3 A4.5,4.5 0 1,1 4,3" />
          <line x1="0" y1="1.5" x2="2.5" y2="-1.5" strokeWidth={1.4} />
        </g>
      );
    default:
      return (
        <g stroke={strokeColor} fill="none" strokeWidth={1.1}>
          <rect x="-3" y="-4" width="6" height="8" rx="1" />
          <line x1="-1.5" y1="-2" x2="1.5" y2="-2" />
          <line x1="-1.5" y1="0" x2="1.5" y2="0" />
        </g>
      );
  }
}

  function renderNode(node: GraphNode) {
    const p         = pos(node.id);
    const cfg       = STATUS[node.status];
    const isSelected = selected === node.id;
    const isHovered  = hovered  === node.id;
    const dimmed     = highlightedNodes && !highlightedNodes.has(node.id);
    const isImpacted = simActive && impactedNodes.has(node.id);
    const inTrace    = impactTrace && traceChain.slice(0, traceStep + 1).includes(node.id);
    const isSearch   = searchQuery.trim() && (
      node.label.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (node.value != null ? String(node.value) : "").toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Dynamic Simulated Values & Live Risk Classification
    let displayVal: string = node.value ? String(node.value) : "";
    let nodeRisk: ConcernLevel = "NOT_SPECIFIED";
    let isNodeSimulated = false;
    let isNodeDerived = false;

    if (node.scenarioKey === "mission_duration_days") {
      const d = derivedTelemetry.duration;
      if (simActive && d.isOverridden) {
        displayVal = `${d.val}`;
        isNodeSimulated = true;
      }
      nodeRisk = evalDuration(d.val);
    } else if (node.scenarioKey === "solar_power_pct") {
      const s = derivedTelemetry.solar;
      if (simActive && s.isOverridden) {
        displayVal = `${s.val}`;
        isNodeSimulated = true;
      }
      nodeRisk = evalPower(s.val, derivedTelemetry.battery.val, derivedTelemetry.consumption.val);
    } else if (node.scenarioKey === "resource_availability_pct") {
      const r = derivedTelemetry.resources;
      if (simActive && (r.isOverridden || r.isDerived)) {
        displayVal = `${r.val}`;
        isNodeSimulated = true;
        isNodeDerived = r.isDerived;
      }
      nodeRisk = evalResources(r.val);
    } else if (node.scenarioKey === "daily_power_consumption_kwh") {
      const c = derivedTelemetry.consumption;
      if (simActive && (c.isOverridden || c.isDerived)) {
        displayVal = `${c.val}`;
        isNodeSimulated = true;
        isNodeDerived = c.isDerived;
      }
      nodeRisk = evalPower(derivedTelemetry.solar.val, derivedTelemetry.battery.val, c.val);
    } else if (node.scenarioKey === "battery_capacity_kwh") {
      const b = derivedTelemetry.battery;
      if (simActive && b.isOverridden) {
        displayVal = `${b.val}`;
        isNodeSimulated = true;
      }
      nodeRisk = evalPower(derivedTelemetry.solar.val, b.val, derivedTelemetry.consumption.val);
    } else if (node.scenarioKey === "communication_delay_min") {
      const c = derivedTelemetry.comm;
      if (simActive && c.isOverridden) {
        displayVal = `${c.val}`;
        isNodeSimulated = true;
      }
      nodeRisk = evalComm(c.val);
    } else if (node.kind === "system") {
      nodeRisk = liveSystemRisks[node.id] ?? "NOT_SPECIFIED";
    }

    // Node sizes: tailored per category
    const rM = 44; // mission
    const rS = 32; // system
    const rP = 22; // param

    const r    = node.kind === "mission" ? rM : node.kind === "system" ? rS : rP;
    const wHUD = node.kind === "mission" ? 96 : node.kind === "system" ? 82 : 64;
    const hHUD = node.kind === "mission" ? 58 : node.kind === "system" ? 48 : 36;

    // Unique geometry calculation
    const geom = getNodeGeometry(node, wHUD, hHUD);

    // System accent color
    const sysAccent = node.kind === "system"
      ? (SYSTEMS.find((s) => s.id === node.id)?.accent ?? cfg.stroke)
      : cfg.stroke;

    // Dynamic stroke & glow colors
    const riskStroke = nodeRisk === "HIGH" ? "#ef4444" : nodeRisk === "MEDIUM" ? "#f59e0b" : nodeRisk === "LOW" ? "#10b981" : cfg.stroke;
    const strokeColor = (isNodeSimulated || isImpacted || inTrace)
      ? riskStroke
      : (isSelected || isHovered) ? cfg.stroke : (node.kind === "system" ? (nodeRisk !== "NOT_SPECIFIED" ? riskStroke : sysAccent) : cfg.stroke);

    const strokeW = isSelected ? 2.5 : isHovered ? 2.2 : (isNodeSimulated || isImpacted || inTrace) ? 2.2 : 1.4;
    const opacity = dimmed ? 0.08 : 1;

    // Ambient glow colors
    const outerGlowFill = (isNodeSimulated || isImpacted || inTrace)
      ? (nodeRisk === "HIGH" ? "rgba(239,68,68,0.25)" : nodeRisk === "MEDIUM" ? "rgba(245,158,11,0.22)" : "rgba(16,185,129,0.22)")
      : cfg.glow.replace(/[\d.]+\)$/, "0.08)");

    const ringGlowFill = (isNodeSimulated || isImpacted || inTrace)
      ? (nodeRisk === "HIGH" ? CONCERN_GLOW.HIGH : nodeRisk === "MEDIUM" ? CONCERN_GLOW.MEDIUM : CONCERN_GLOW.LOW)
      : cfg.glow;

    // Gradient id for this node (unique per id)
    const gradId  = `g_${node.id.replace(/[^a-z0-9]/gi, "_")}`;
    const glowId  = `gl_${node.id.replace(/[^a-z0-9]/gi, "_")}`;

    const sysRisk = node.kind === "system" ? liveSystemRisks[node.id] : undefined;

    return (
      <g
        key={node.id}
        className="node-group"
        style={{ cursor: "pointer", opacity, transition: "opacity 0.25s, transform 0.25s" }}
        transform={`translate(${p.x},${p.y})`}
        onMouseEnter={() => setHovered(node.id)}
        onMouseLeave={() => setHovered(null)}
        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
        onClick={() => handleNodeClick(node.id)}
        onDoubleClick={() => handleNodeDblClick(node.id)}
      >
        {/* Outer ambient glow */}
        <circle
          r={r + 16}
          fill={outerGlowFill}
          style={{ transition: "all 0.4s" }}
        />

        {/* Focused / selected glow ring */}
        {(isSelected || isHovered || isNodeSimulated || isImpacted || inTrace || isSearch) && (
          <circle
            r={r + 9}
            fill={ringGlowFill}
            filter="url(#nodeGlow)"
          />
        )}

        {/* High Risk Double Emergency Contour */}
        {nodeRisk === "HIGH" && (
          <path
            d={geom.path}
            fill="none"
            stroke="#ef4444"
            strokeWidth={0.8}
            strokeDasharray="4 3"
            opacity={0.7}
            transform="scale(1.1)"
          />
        )}

        {/* Custom Geometric Shape Card Body */}
        <path
          d={geom.path}
          fill={`url(#${gradId})`}
          stroke={strokeColor}
          strokeWidth={strokeW}
          strokeDasharray={node.status === "missing" && !isNodeSimulated ? "3 3" : undefined}
          style={{ transition: "stroke 0.3s, stroke-width 0.3s" }}
        />

        {/* Mission Core: slow counter-rotating reticle rings */}
        {node.kind === "mission" && (
          <g style={{ pointerEvents: "none" }}>
            <circle r={r + 14} fill="none" stroke="#06b6d4" strokeWidth={0.8} strokeDasharray="4 8" opacity={0.4}>
              <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="90s" repeatCount="indefinite" />
            </circle>
            <circle r={r + 22} fill="none" stroke="#3b82f6" strokeWidth={0.5} strokeDasharray="8 14" opacity={0.25}>
              <animateTransform attributeName="transform" type="rotate" from="360" to="0" dur="120s" repeatCount="indefinite" />
            </circle>
            <circle r={r + 30} fill="none" stroke="#60a5fa" strokeWidth={0.3} strokeDasharray="2 20" opacity={0.15} />
            {/* Core pulsing beacon dot */}
            <circle cx={-wHUD / 2 + 12} cy={-hHUD / 2 + 12} r={2.5} fill="#38bdf8" filter="url(#nodeGlow)" />
          </g>
        )}

        {/* System Node Corner Accents */}
        {node.kind === "system" && (
          <g style={{ pointerEvents: "none" }}>
            {/* Top accent line */}
            <line x1={-wHUD / 2 + 10} y1={-hHUD / 2} x2={wHUD / 2 - 10} y2={-hHUD / 2} stroke={strokeColor} strokeWidth={2} opacity={0.9} />
            {/* Corner ticks */}
            {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx2, sy2], i) => (
              <path key={i}
                d={`M${sx2 * (wHUD / 2 - 4)},${sy2 * (hHUD / 2)} L${sx2 * (wHUD / 2)},${sy2 * (hHUD / 2)} L${sx2 * (wHUD / 2)},${sy2 * (hHUD / 2 - 4)}`}
                fill="none" stroke={strokeColor} strokeWidth={1} opacity={0.75}
              />
            ))}
          </g>
        )}

        {/* Vector SVG Icon rendered inside node */}
        <g transform={`translate(${node.kind === "mission" ? -wHUD / 2 + 14 : node.kind === "system" ? -wHUD / 2 + 14 : -wHUD / 2 + 11}, ${node.kind === "param" ? 0 : 0})`}>
          {renderNodeGlyph(geom.iconType, strokeColor)}
        </g>

        {/* Impact / trace slow pulsing halo */}
        {(isNodeSimulated || isImpacted || inTrace) && (
          <path
            d={geom.path}
            fill="none"
            stroke={riskStroke}
            strokeWidth={1.4}
            strokeDasharray="4 6"
            opacity={0.85}
            transform="scale(1.15)"
          >
            <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="24s" repeatCount="indefinite" />
          </path>
        )}

        {/* Search highlight */}
        {isSearch && (
          <path
            d={geom.path}
            fill="none"
            stroke="#fbbf24"
            strokeWidth={2}
            opacity={0.9}
            transform="scale(1.1)"
          />
        )}

        {/* ── Label & value text ── */}
        {/* Node kind chip */}
        {node.kind !== "mission" && (
          <text
            x={node.kind === "system" ? 8 : 7}
            y={-hHUD / 2 + 9}
            textAnchor="middle"
            fontSize={5.2}
            fontFamily="'Courier New',monospace"
            fill={node.kind === "system" ? strokeColor : cfg.stroke}
            opacity={0.75}
            fontWeight="600"
            letterSpacing="0.08em"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {node.kind === "system" ? "SUBSYSTEM" : "PARAM"}
          </text>
        )}

        {/* Main label */}
        <text
          x={node.kind === "mission" ? 4 : node.kind === "system" ? 8 : 7}
          y={node.kind === "param" && (displayVal || node.value) ? -3 : node.kind === "mission" ? -3 : 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={node.kind === "mission" ? 10.5 : node.kind === "system" ? 8.5 : 6.8}
          fontWeight={node.kind === "mission" ? "800" : node.kind === "system" ? "700" : "600"}
          fontFamily="'Courier New',monospace"
          fill={node.status === "missing" && !isNodeSimulated ? "#64748b" : "#f1f5f9"}
          letterSpacing="0.04em"
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {node.label.length > (node.kind === "mission" ? 15 : node.kind === "system" ? 12 : 10)
            ? node.label.slice(0, node.kind === "mission" ? 14 : node.kind === "system" ? 11 : 9) + "…"
            : node.label}
        </text>

        {/* Mission Subtitle */}
        {node.kind === "mission" && (
          <text
            y={12}
            textAnchor="middle"
            fontSize={6.5}
            fontFamily="'Courier New',monospace"
            fill="#38bdf8"
            opacity={0.9}
            fontWeight="600"
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {node.value ? String(node.value).slice(0, 16) : "PRIMARY SYSTEM"}
          </text>
        )}

        {/* Value line */}
        {node.kind === "param" && (displayVal || node.value) && (
          <text
            x={7}
            y={8}
            textAnchor="middle"
            fontSize={6}
            fontWeight="700"
            fontFamily="'Courier New',monospace"
            fill={isNodeSimulated ? riskStroke : cfg.stroke}
            opacity={0.95}
            style={{ pointerEvents: "none", userSelect: "none" }}
          >
            {displayVal.slice(0, 12)}
            {node.unit ? ` ${node.unit}` : ""}
          </text>
        )}

        {/* Dynamic Simulated / Derived badge on top */}
        {simActive && isNodeSimulated && (
          <g style={{ pointerEvents: "none" }}>
            <rect
              x={-22} y={-hHUD / 2 - 14} width={44} height={11} rx={3}
              fill={nodeRisk === "HIGH" ? "rgba(239,68,68,0.25)" : nodeRisk === "MEDIUM" ? "rgba(245,158,11,0.25)" : "rgba(16,185,129,0.25)"}
              stroke={riskStroke} strokeWidth={0.8}
            />
            <text
              x={0} y={-hHUD / 2 - 6} textAnchor="middle" fontSize={5.5}
              fontFamily="'Courier New',monospace" fill={riskStroke} fontWeight="800" letterSpacing="0.05em"
            >
              {isNodeDerived ? `↳ SIM ${displayVal}` : `SIM ${displayVal}`}
            </text>
          </g>
        )}

        {/* System risk badge */}
        {sysRisk && sysRisk !== "NOT_SPECIFIED" && (
          <g style={{ pointerEvents: "none" }}>
            <rect x={wHUD / 2 - 24} y={-hHUD / 2 + 2} width={22} height={9} rx={3}
              fill={CONCERN_GLOW[sysRisk]} stroke={CONCERN_COLOR[sysRisk]} strokeWidth={0.6} />
            <text x={wHUD / 2 - 13} y={-hHUD / 2 + 8.5} textAnchor="middle" fontSize={5}
              fontFamily="'Courier New',monospace" fill={CONCERN_COLOR[sysRisk]} fontWeight="800" letterSpacing="0.06em">
              {sysRisk}
            </text>
          </g>
        )}

        {/* SVG gradient def */}
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={
              (isNodeSimulated || isImpacted || inTrace)
                ? (nodeRisk === "HIGH" ? "rgba(239,68,68,0.32)" : nodeRisk === "MEDIUM" ? "rgba(245,158,11,0.28)" : "rgba(16,185,129,0.28)")
                : node.kind === "mission" ? "rgba(6,182,212,0.22)" : cfg.glassTop
            } />
            <stop offset="100%" stopColor={
              (isNodeSimulated || isImpacted || inTrace)
                ? (nodeRisk === "HIGH" ? "rgba(40,10,15,0.92)" : nodeRisk === "MEDIUM" ? "rgba(35,20,10,0.88)" : "rgba(8,32,20,0.88)")
                : node.kind === "mission" ? "rgba(6,18,38,0.85)" : cfg.glassBot
            } />
          </linearGradient>
          <filter id={glowId}>
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
      </g>
    );
  }

  // ── Telemetry panel sections ───────────────────────────────────────────────────

  function renderTelemetryEmpty() {
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-5 py-10 gap-4 text-center">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none" opacity={0.25}>
          <circle cx="20" cy="20" r="16" stroke="#3b82f6" strokeWidth="1.2" />
          <circle cx="20" cy="20" r="8"  stroke="#3b82f6" strokeWidth="1.2" />
          <line x1="4"  y1="20" x2="12" y2="20" stroke="#3b82f6" strokeWidth="1.2" />
          <line x1="28" y1="20" x2="36" y2="20" stroke="#3b82f6" strokeWidth="1.2" />
          <line x1="20" y1="4"  x2="20" y2="12" stroke="#3b82f6" strokeWidth="1.2" />
          <line x1="20" y1="28" x2="20" y2="36" stroke="#3b82f6" strokeWidth="1.2" />
        </svg>
        <div>
          <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-wider leading-relaxed">
            Select a node or connection<br />to inspect mission telemetry
          </p>
          <p className="text-[9px] text-[var(--text-muted)] opacity-50 mt-2 leading-relaxed">
            Drag nodes · Scroll to zoom<br />Pan canvas · Dbl-click system to focus<br />⌨ Arrow keys step impact trace
          </p>
        </div>
      </div>
    );
  }

  function renderEdgeTelemetry(edge: GraphEdge) {
    const srcNode = allNodes.find((n) => n.id === edge.source);
    const tgtNode = allNodes.find((n) => n.id === edge.target);
    const dirColor = edge.direction === "up" ? "#f59e0b" : edge.direction === "down" ? "#ef4444" : "#3b82f6";
    const dirLabel = edge.direction === "up" ? "↑ Increases" : edge.direction === "down" ? "↓ Decreases" : "↔ Neutral";

    return (
      <div className="flex-1 flex flex-col divide-y divide-[#0d1e35] overflow-y-auto min-h-0">
        <div className="px-4 py-3 space-y-2">
          <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Causal Dependency</div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 rounded text-[9px] font-mono border border-[#1e3a5f] text-[#60a5fa]">{srcNode?.label ?? edge.source}</span>
            <span className="text-[#f59e0b] font-mono text-sm">→</span>
            <span className="px-2 py-0.5 rounded text-[9px] font-mono border border-[#1e3a5f] text-[#60a5fa]">{tgtNode?.label ?? edge.target}</span>
          </div>
        </div>
        {edge.label && (
          <div className="px-4 py-3 space-y-1">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Relationship</div>
            <div className="text-[10px] font-mono font-semibold" style={{ color: dirColor }}>{edge.label}</div>
          </div>
        )}
        {edge.rule && (
          <div className="px-4 py-3 space-y-1">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Causal Rule</div>
            <div className="text-[10px] text-[var(--text-muted)] leading-relaxed font-mono">{edge.rule}</div>
          </div>
        )}
        <div className="px-4 py-3 space-y-1">
          <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Impact Direction</div>
          <div className="text-[10px] font-mono font-bold" style={{ color: dirColor }}>{dirLabel}</div>
          {edge.strength !== undefined && (
            <div className="flex items-center gap-2 mt-1">
              <div className="text-[9px] text-[var(--text-muted)] font-mono">Strength</div>
              <div className="flex-1 h-1 rounded-full bg-[#0d1e35] overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${edge.strength * 100}%`, background: dirColor }} />
              </div>
              <div className="text-[9px] font-mono" style={{ color: dirColor }}>{Math.round((edge.strength ?? 0) * 100)}%</div>
            </div>
          )}
        </div>
        <div className="px-4 py-3">
          <Link href={scenarioLabUrl}
            className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-[#1e3a5f] text-[10px] font-mono text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent-glow)] transition-all">
            Open in Scenario Lab →
          </Link>
        </div>
      </div>
    );
  }

  function renderNodeTelemetry(node: GraphNode) {
    const cfg    = STATUS[node.status];
    const simKey = node.scenarioKey;
    const simVal = simKey ? simValues[simKey] : undefined;
    const canSim = node.kind === "param" && !!simKey;

    const connectedIds = Array.from(
      new Set(
        edges
          .filter((e) => e.source === node.id || e.target === node.id)
          .map((e) => (e.source === node.id ? e.target : e.source))
          .filter((id) => id !== node.id)
      )
    );
    const upstreamEdges  = edges.filter((e) => e.kind === "causal" && e.target === node.id);
    const downstreamEdges = edges.filter((e) => e.kind === "causal" && e.source === node.id);
    const connectedNodes = connectedIds
      .map((id) => allNodes.find((n) => n.id === id))
      .filter(Boolean) as GraphNode[];

    const riskMap: Record<string, { base: ConcernLevel; sim?: ConcernLevel }> = {
      power:    { base: baseRisk.power,    sim: simActive ? simRisk.power    : undefined },
      resources:{ base: baseRisk.resources, sim: simActive ? simRisk.resources : undefined },
      comms:    { base: baseRisk.communication, sim: simActive ? simRisk.communication : undefined },
      profile:  { base: baseRisk.duration, sim: simActive ? simRisk.duration  : undefined },
    };
    const sysRiskEntry = node.kind === "system" ? riskMap[node.id] : undefined;

    const systemDesc: Record<string, string> = {
      power: "Power generation and consumption subsystem.",
      crew: "Crew composition, health, and human factors.",
      comms: "Communication architecture and signal delays.",
      resources: "Resource availability, logistics, and margins.",
      profile: "Mission profile — destination, type, and objectives.",
      constraints: "Planning constraints and identified knowledge gaps.",
    };

    return (
      <div className="flex-1 flex flex-col divide-y divide-[#0d1e35] overflow-y-auto min-h-0">

        {/* Identity */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-sm border" style={{ borderColor: cfg.stroke, background: cfg.glassTop }} />
            <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">{cfg.label}</span>
            {node.kind !== "mission" && (
              <span className="ml-auto text-[9px] font-mono text-[var(--text-muted)]">
                {node.kind === "system" ? "SUBSYSTEM" : "PARAMETER"}
              </span>
            )}
          </div>
          <div className="text-sm font-bold font-mono leading-tight" style={{ color: cfg.stroke }}>
            {node.label}
          </div>
          {node.kind === "system" && (
            <div className="text-[10px] text-[var(--text-muted)] leading-relaxed">{systemDesc[node.id] ?? ""}</div>
          )}
          {sysRiskEntry && (
            <div className="flex items-center gap-3 pt-1">
              <div>
                <div className="text-[8px] font-mono text-[var(--text-muted)] uppercase mb-0.5">Baseline</div>
                <span className="text-[10px] font-mono font-bold" style={{ color: CONCERN_COLOR[sysRiskEntry.base] }}>
                  {sysRiskEntry.base}
                </span>
              </div>
              {sysRiskEntry.sim && sysRiskEntry.sim !== sysRiskEntry.base && (
                <>
                  <span className="text-[var(--text-muted)] font-mono">→</span>
                  <div>
                    <div className="text-[8px] font-mono text-[var(--amber)] uppercase mb-0.5">Simulated</div>
                    <span className="text-[10px] font-mono font-bold" style={{ color: CONCERN_COLOR[sysRiskEntry.sim] }}>
                      {sysRiskEntry.sim}
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* 2. Live Parameter Control & Current Value Readout (TOP POSITION) */}
        {canSim && simKey ? (() => {
          let min = 0;
          let max = 100;
          let step = 1;
          if (simKey === "solar_power_pct" || simKey === "resource_availability_pct") {
            min = 0;
            max = 100;
            step = 1;
          } else if (simKey === "mission_duration_days") {
            min = 1;
            max = 3650;
            step = 1;
          } else if (simKey === "communication_delay_min") {
            min = 0;
            max = 120;
            step = 0.5;
          } else if (simKey === "battery_capacity_kwh") {
            min = 5;
            max = 2000;
            step = 5;
          } else if (simKey === "daily_power_consumption_kwh") {
            min = 1;
            max = 500;
            step = 1;
          }
          const currentVal = simVal ?? (node.numeric ?? Math.round((min + max) / 2));

          let curRisk: ConcernLevel = "NOT_SPECIFIED";
          if (simKey === "mission_duration_days") curRisk = evalDuration(currentVal);
          else if (simKey === "solar_power_pct") curRisk = evalPower(currentVal, derivedTelemetry.battery.val, derivedTelemetry.consumption.val);
          else if (simKey === "resource_availability_pct") curRisk = evalResources(currentVal);
          else if (simKey === "daily_power_consumption_kwh") curRisk = evalPower(derivedTelemetry.solar.val, derivedTelemetry.battery.val, currentVal);
          else if (simKey === "battery_capacity_kwh") curRisk = evalPower(derivedTelemetry.solar.val, currentVal, derivedTelemetry.consumption.val);
          else if (simKey === "communication_delay_min") curRisk = evalComm(currentVal);

          const paramColor = curRisk === "HIGH" ? "#ef4444" : curRisk === "MEDIUM" ? "#f59e0b" : curRisk === "LOW" ? "#10b981" : "#3b82f6";

          return (
            <div
              className="px-4 py-3 space-y-2.5 bg-[#030914]"
              onMouseDown={(e) => e.stopPropagation()}
              onMouseMove={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
            >
              <div className="text-[9px] font-mono uppercase tracking-wider flex items-center justify-between" style={{ color: simVal !== undefined ? paramColor : "var(--accent-glow)" }}>
                <span className="flex items-center gap-1.5 font-bold">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: simVal !== undefined ? paramColor : "var(--accent)" }} />
                  Live Parameter Control
                </span>
                {simVal !== undefined && (
                  <span className="text-[8px] px-1.5 py-0.2 rounded border border-amber-500/40 bg-amber-500/20 text-amber-300 font-bold">
                    SIM ACTIVE
                  </span>
                )}
              </div>

              {/* Number Input + Range Display */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1 text-[8.5px] font-mono text-[var(--text-muted)]">
                  <span>Range:</span>
                  <span className="text-[#64748b]">{min}</span>
                  <span>–</span>
                  <span className="text-[#64748b]">{max}{simKey.includes("pct") ? "%" : ""}</span>
                </div>
                {/* Editable number input */}
                <div className="flex items-center gap-1.5 bg-[#061224] border border-[#1e3a5f] focus-within:border-[var(--accent)] focus-within:ring-1 focus-within:ring-[var(--accent-glow)]/40 rounded px-2 py-0.5 transition-all">
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={simKey.includes("kwh") ? 1 : 1}
                    value={currentVal}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const raw = e.target.value;
                      if (raw === "") {
                        handleSimChange(simKey, min);
                        return;
                      }
                      const v = Number(raw);
                      if (!isNaN(v)) {
                        handleSimChange(simKey, v);
                      }
                    }}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (isNaN(v)) {
                        handleSimChange(simKey, min);
                      } else {
                        handleSimChange(simKey, Math.max(min, Math.min(max, v)));
                      }
                    }}
                    className="w-16 bg-transparent text-right font-mono font-bold text-xs outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    style={{ color: simVal !== undefined ? paramColor : cfg.stroke }}
                  />
                  {node.unit && (
                    <span className="text-[9px] font-mono text-[var(--text-muted)] select-none">
                      {node.unit}
                    </span>
                  )}
                </div>
              </div>

              {/* Range Slider */}
              <input
                type="range"
                min={min} max={max} step={simKey.includes("kwh") ? 1 : 1}
                value={Math.max(min, Math.min(max, currentVal))}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onTouchStart={(e) => e.stopPropagation()}
                onChange={(e) => handleSimChange(simKey, Number(e.target.value))}
                className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                style={{ accentColor: simVal !== undefined ? paramColor : "#3b82f6" }}
              />

              {/* Baseline vs Sim delta pill */}
              {node.value && (
                <div className="flex items-center justify-between text-[8.5px] font-mono text-[var(--text-muted)] pt-0.5">
                  <span>Baseline: <strong className="text-[var(--text-primary)]">{node.value} {node.unit ?? ""}</strong></span>
                  {simVal !== undefined && (
                    <span className="font-bold" style={{ color: paramColor }}>
                      SIM: {simVal} {node.unit ?? ""} ({simVal - Number(node.numeric ?? 0) >= 0 ? "+" : ""}{simVal - Number(node.numeric ?? 0)})
                    </span>
                  )}
                </div>
              )}

              {/* Reset button */}
              {simVal !== undefined && (
                <button
                  onClick={() => {
                    const s = { ...simValues };
                    delete s[simKey];
                    setSimValues(s);
                    if (Object.keys(s).length === 0) setSimActive(false);
                  }}
                  className="text-[8.5px] font-mono text-[var(--text-muted)] hover:text-white transition-colors flex items-center gap-1"
                >
                  ↺ Reset this parameter
                </button>
              )}
            </div>
          );
        })() : (node.value || node.unit) && (
          <div className="px-4 py-3 space-y-2">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Current Value</div>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-base font-bold" style={{ color: cfg.stroke }}>
                {simVal !== undefined ? String(simVal) : (node.value ?? "—")}
              </span>
              {node.unit && <span className="text-[10px] text-[var(--text-muted)] font-mono">{node.unit}</span>}
            </div>
            {simVal !== undefined && node.value && (
              <div className="flex items-center gap-2 text-[9px] font-mono text-[var(--text-muted)]">
                <span>Baseline:</span>
                <span className="text-[var(--text-primary)]">{node.value} {node.unit ?? ""}</span>
                <span className="text-[var(--amber)]">→ SIM: {simVal}</span>
              </div>
            )}
          </div>
        )}

        {/* 3. Real-Time Cascading Impacts (DIRECTLY UNDER PARAMETER CONTROLS) */}
        {downstreamEdges.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            <div className="text-[9px] font-mono text-[var(--amber)] uppercase tracking-wider flex items-center justify-between">
              <span>Real-Time Cascading Impacts</span>
              {simActive && (
                <span className="text-[8px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.5 rounded font-mono font-bold">
                  ACTIVE SIM
                </span>
              )}
            </div>
            {downstreamEdges.map((e, idx) => {
              const tgt = allNodes.find((n) => n.id === e.target);
              let liveDelta = "";
              let physicsNote = "";
              if (node.scenarioKey === "mission_duration_days" && tgt?.scenarioKey === "resource_availability_pct") {
                const diff = derivedTelemetry.resources.val - derivedTelemetry.resources.base;
                liveDelta = `Remaining Resources: ${derivedTelemetry.resources.base}% → ${derivedTelemetry.resources.val}% (${diff >= 0 ? "+" : ""}${diff}%)`;
                physicsNote = "Rule-based consumable reserve & life-support recycling estimation.";
              } else if (node.scenarioKey === "mission_duration_days" && tgt?.scenarioKey === "daily_power_consumption_kwh") {
                const diff = derivedTelemetry.consumption.val - derivedTelemetry.consumption.base;
                liveDelta = `Power Demand: ${derivedTelemetry.consumption.base} kWh → ${derivedTelemetry.consumption.val} kWh (${diff >= 0 ? "+" : ""}${diff} kWh)`;
                physicsNote = "Rule-based radiative coating wear & thermal control load.";
              } else if (node.scenarioKey === "mission_duration_days" && tgt?.id === "constraints") {
                const radMsv = (derivedTelemetry.duration.val * 0.67).toFixed(1);
                const pctOfLimit = ((derivedTelemetry.duration.val * 0.67 / 600) * 100).toFixed(0);
                liveDelta = `Cumulative Radiation: ${radMsv} mSv (${pctOfLimit}% NASA Career Limit)`;
                physicsNote = "Galactic cosmic ray and solar particle dose accumulation.";
              } else if (node.scenarioKey === "solar_power_pct" && tgt?.scenarioKey === "battery_capacity_kwh") {
                const supplyKwh = Math.round((derivedTelemetry.solar.val / 100) * derivedTelemetry.battery.val);
                const batteryRetention = Math.round(derivedTelemetry.battery.val * (1 - Math.exp(-0.04 * derivedTelemetry.solar.val)));
                liveDelta = `Usable Solar Generation: ${supplyKwh} kWh/day`;
                physicsNote = `Battery buffer retention: ${batteryRetention} kWh (Peukert cycling reserve).`;
              } else if (node.scenarioKey === "solar_power_pct" && tgt?.scenarioKey === "resource_availability_pct") {
                liveDelta = `Recycling Availability: ${derivedTelemetry.resources.val}%`;
                physicsNote = "Sigmoidal ECLSS load-shed threshold at <65% solar power.";
              } else if (node.scenarioKey === "communication_delay_min" && tgt?.id === "comms") {
                const rtt = (derivedTelemetry.comm.val * 2).toFixed(1);
                liveDelta = `Signal Propagation: ${rtt} min Round-Trip (RTT)`;
                physicsNote = `Radio link window: Telemetry packets and ground command confirmations take ${rtt}m.`;
              } else if (node.scenarioKey === "communication_delay_min" && tgt?.id === "crew") {
                const turnaround = (derivedTelemetry.comm.val * 2 + 3.5 * Math.pow(Math.max(0.1, derivedTelemetry.comm.val / 5), 1.35)).toFixed(1);
                liveDelta = `Tactical Decision Loop: ${turnaround} min Response Window`;
                physicsNote = derivedTelemetry.comm.val > 1.5
                  ? "Crew Autonomy Mandate: Ground abort assistance is disabled; crew must resolve emergencies independently."
                  : "Nominal Voice Link: Real-time ground flight director abort authorization active.";
              }
              return (
                <div key={`down_${e.id}_${idx}`} className="p-2.5 rounded bg-[#0a1526]/80 border border-[#1e3a5f]/60 space-y-1">
                  <div className="flex items-center justify-between text-[9px] font-mono">
                    <span className="text-[var(--text-primary)] font-bold">{node.label}</span>
                    <span className="text-[var(--amber)]">➔ {tgt?.label ?? e.target}</span>
                  </div>
                  {liveDelta && (
                    <div className="text-[10px] font-mono text-[#fbbf24] font-bold">
                      {liveDelta}
                    </div>
                  )}
                  {physicsNote && (
                    <div className="text-[8.5px] font-mono text-sky-300/80">
                      ⚡ {physicsNote}
                    </div>
                  )}
                  <div className="text-[8.5px] text-[var(--text-muted)] italic leading-relaxed pt-0.5">
                    {e.rule}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 4. Connected nodes */}
        {connectedNodes.length > 0 && (
          <div className="px-4 py-3 space-y-2">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
              Connected Nodes ({connectedNodes.length})
            </div>
            <div className="flex flex-wrap gap-1">
              {connectedNodes.map((cn, idx) => (
                <button
                  key={`conn_${cn.id}_${idx}`}
                  onClick={() => setSelected(cn.id)}
                  className="px-1.5 py-0.5 rounded border text-[8px] font-mono transition-all hover:brightness-125"
                  style={{ borderColor: STATUS[cn.status].stroke + "55", color: STATUS[cn.status].stroke, background: STATUS[cn.status].glassBot }}
                >
                  {cn.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. Upstream dependencies */}
        {upstreamEdges.length > 0 && (
          <div className="px-4 py-3 space-y-1.5">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Upstream Dependencies</div>
            {upstreamEdges.map((e, idx) => {
              const src = allNodes.find((n) => n.id === e.source);
              return (
                <div key={`up_${e.id}_${idx}`} className="flex items-center gap-1.5 text-[9px] font-mono text-[var(--text-muted)]">
                  <span className="text-[var(--accent-glow)]">{src?.label ?? e.source}</span>
                  <span>→</span>
                  <span className="text-[var(--text-primary)]">{node.label}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* 6. Source evidence */}
        {node.sourceText && (
          <div className="px-4 py-3 space-y-1.5">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Source Evidence</div>
            <div className="text-[10px] text-[var(--text-muted)] italic border-l-2 border-[#1e3a5f] pl-2 leading-relaxed">
              &ldquo;{node.sourceText.slice(0, 120)}{node.sourceText.length > 120 ? "…" : ""}&rdquo;
              {node.sourcePage && <span className="not-italic ml-1 text-[var(--text-muted)]">(p.{node.sourcePage})</span>}
            </div>
          </div>
        )}

        {/* 7. Impact propagation readout */}
        {simActive && impactedNodes.has(node.id) && (
          <div className="px-4 py-3 space-y-1.5 bg-amber-500/5 border-t border-amber-500/20">
            <div className="text-[9px] font-mono text-[var(--amber)] uppercase tracking-wider flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] animate-pulse" />
              Simulated Downstream Impact Propagated
            </div>
            {node.id === "power" && simRisk.power && (
              <div className="text-[10px] font-mono font-bold" style={{ color: CONCERN_COLOR[simRisk.power] }}>
                Power Readiness Risk: {baseRisk.power} → {simRisk.power}
              </div>
            )}
            {node.id === "resources" && simRisk.resources && (
              <div className="text-[10px] font-mono font-bold" style={{ color: CONCERN_COLOR[simRisk.resources] }}>
                ECLSS Life Support Risk: {baseRisk.resources} → {simRisk.resources}
              </div>
            )}
            {node.id === "constraints" && (
              <div className="text-[10px] font-mono font-bold text-amber-400">
                Planning Constraints: {liveSystemRisks.constraints}
              </div>
            )}
            <div className="text-[9px] text-[var(--text-muted)] leading-relaxed">
              This node is downstream of a live simulated change. All connected variables and dependency lines reflect real-time physical effects.
            </div>
          </div>
        )}

        {/* Risk note */}
        {node.riskNote && (
          <div className="px-4 py-3 space-y-1">
            <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">Risk Note</div>
            <div className="text-[10px] text-[var(--amber)] leading-relaxed">{node.riskNote}</div>
          </div>
        )}

        {/* Scenario Lab CTA */}
        <div className="px-4 py-3 mt-auto">
          <Link
            href={scenarioLabUrl}
            className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-lg text-[10px] font-mono font-semibold transition-all"
            style={{
              background: simActive ? "linear-gradient(135deg,rgba(245,158,11,0.2),rgba(245,158,11,0.08))" : "linear-gradient(135deg,rgba(59,130,246,0.2),rgba(59,130,246,0.08))",
              border: `1px solid ${simActive ? "rgba(245,158,11,0.4)" : "rgba(59,130,246,0.3)"}`,
              color: simActive ? "#fbbf24" : "#60a5fa",
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1 9l3-3 1.5 1.5L8 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {simActive ? "Send Simulation to Scenario Lab" : "Open in Scenario Lab"}
          </Link>
        </div>
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="flex rounded-xl border border-[#0d1e35] overflow-hidden"
      style={{
        background: "#03060e",
        height: isFullscreen ? "100vh" : 640,
        minHeight: isFullscreen ? "100vh" : 640,
        maxHeight: isFullscreen ? "100vh" : 640,
      }}
    >

      {/* ════════════════════ MAP CANVAS ════════════════════ */}
      <div
        className="relative flex-1 overflow-hidden select-none h-full min-w-0"
        style={{ cursor: isPanning ? "grabbing" : "grab" }}
      >

        {/* ── Top HUD bar ── */}
        <div className="absolute top-0 left-0 right-0 z-20 flex items-center gap-2.5 px-4 py-2"
          style={{ background: "linear-gradient(to bottom,rgba(3,6,14,0.96),rgba(3,6,14,0.85))", borderBottom: "1px solid #0d1e35" }}>
          {/* Indicator */}
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
          <span className="text-[10px] font-mono text-[var(--accent-glow)] uppercase tracking-widest whitespace-nowrap">
            Interactive Mission Dependency Model
          </span>
          {missionId && (
            <span className="text-[9px] font-mono text-[var(--text-muted)] hidden sm:inline">
              · {missionId.slice(0, 8).toUpperCase()}
            </span>
          )}

          {/* Search */}
          <div className="flex items-center gap-1.5 ml-1 flex-1 max-w-[160px]">
            <svg width="9" height="9" viewBox="0 0 9 9" fill="none" className="shrink-0">
              <circle cx="4" cy="4" r="3" stroke="#475569" strokeWidth="1" />
              <line x1="6.5" y1="6.5" x2="8.5" y2="8.5" stroke="#475569" strokeWidth="1" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes…"
              className="bg-transparent border-b border-[#1e3a5f] text-[9px] font-mono text-[var(--text-primary)] placeholder-[#334155] outline-none w-full pb-0.5"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="text-[#475569] hover:text-white text-[9px] font-mono shrink-0">✕</button>
            )}
          </div>

          {/* Quick Interactive Presets */}
          <div className="flex items-center gap-1 ml-1 overflow-x-auto">
            <span className="text-[7.5px] font-mono text-[var(--text-muted)] uppercase hidden md:inline">Stress:</span>
            <button
              onClick={() => triggerPreset("solar_drop")}
              title="Simulate Solar Flare: Solar Power drops to 55%"
              className={`px-1.5 py-0.5 rounded text-[7.5px] font-mono font-semibold transition-all border ${simValues.solar_power_pct === 55 ? "bg-[rgba(245,158,11,0.25)] border-[#f59e0b] text-[#fbbf24]" : "border-[#1e3a5f] bg-[rgba(6,14,30,0.8)] text-[#93c5fd] hover:border-[#3b82f6]"}`}>
              ⚡ Solar -45%
            </button>
            <button
              onClick={() => triggerPreset("duration_surge")}
              title="Simulate Mission Extension: Duration extended to 720 days"
              className={`px-1.5 py-0.5 rounded text-[7.5px] font-mono font-semibold transition-all border ${simValues.mission_duration_days === 720 ? "bg-[rgba(245,158,11,0.25)] border-[#f59e0b] text-[#fbbf24]" : "border-[#1e3a5f] bg-[rgba(6,14,30,0.8)] text-[#93c5fd] hover:border-[#3b82f6]"}`}>
              ⏱️ +180d
            </button>
            <button
              onClick={() => triggerPreset("comm_delay")}
              title="Simulate Deep Space Comm Lag: Delay increases to 35 min"
              className={`px-1.5 py-0.5 rounded text-[7.5px] font-mono font-semibold transition-all border ${simValues.communication_delay_min === 35 ? "bg-[rgba(245,158,11,0.25)] border-[#f59e0b] text-[#fbbf24]" : "border-[#1e3a5f] bg-[rgba(6,14,30,0.8)] text-[#93c5fd] hover:border-[#3b82f6]"}`}>
              📡 35m Lag
            </button>
            {simActive && (
              <button
                onClick={() => triggerPreset("reset")}
                className="px-1.5 py-0.5 rounded text-[7.5px] font-mono border border-red-500/40 text-red-400 bg-red-950/30 hover:bg-red-900/40 transition-all">
                ↺ Clear
              </button>
            )}
          </div>

          <div className="flex-1" />

          {/* Impact trace stepper */}
          {impactTrace && traceChain.length > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[rgba(245,158,11,0.4)] bg-[rgba(245,158,11,0.1)]">
              <button onClick={() => setTraceStep((s) => Math.max(0, s - 1))}
                disabled={traceStep === 0}
                className="text-[9px] font-mono text-[var(--amber)] disabled:opacity-30 hover:text-white transition-colors">
                ←
              </button>
              <span className="text-[8px] font-mono text-[var(--amber)] whitespace-nowrap">
                Step {traceStep + 1}/{traceChain.length}:&nbsp;
                <span className="text-white">{allNodes.find((n) => n.id === traceChain[traceStep])?.label ?? ""}</span>
              </span>
              <button onClick={() => setTraceStep((s) => Math.min(traceChain.length - 1, s + 1))}
                disabled={traceStep === traceChain.length - 1}
                className="text-[9px] font-mono text-[var(--amber)] disabled:opacity-30 hover:text-white transition-colors">
                →
              </button>
            </div>
          )}
        </div>

        {/* ── Dedicated Floating Map Controls Dock (Always 100% Visible & Accessible) ── */}
        <div
          className="absolute top-12 right-3 z-30 flex items-center gap-1 p-1 rounded-lg border border-[#1e3a5f]/90 shadow-2xl backdrop-blur-md"
          style={{ background: "rgba(4,10,24,0.92)" }}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          {[
            { t: "+", title: "Zoom In", a: () => setTransform((t) => ({ ...t, scale: Math.min(MAX_ZOOM, t.scale * 1.10) })) },
            { t: "−", title: "Zoom Out", a: () => setTransform((t) => ({ ...t, scale: Math.max(MIN_ZOOM, t.scale / 1.10) })) },
            { t: "⊙", title: "Center View", a: () => setTransform({ x: 0, y: 0, scale: 1 }) },
            { t: "↺", title: "Snap Nodes to Orbit", a: resetLayout },
            { t: isFullscreen ? "⤡" : "⤢", title: "Toggle Fullscreen", a: toggleFullscreen },
          ].map(({ t, title, a }) => (
            <button key={t} onClick={a} title={title}
              className="w-6 h-6 rounded border border-[#1e3a5f] bg-[rgba(6,14,30,0.85)] text-[var(--text-muted)] hover:text-white hover:border-[var(--accent)] hover:bg-[rgba(59,130,246,0.25)] transition-all text-xs font-mono flex items-center justify-center cursor-pointer">
              {t}
            </button>
          ))}
        </div>

        {/* ── Bottom filter bar ── */}
        <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-2 px-4 py-2"
          style={{ background: "linear-gradient(to top,rgba(3,6,14,0.9),transparent)" }}>
          <span className="text-[8px] font-mono text-[#1e3a5f] uppercase tracking-wider">Focus:</span>
          <button
            onClick={() => focusOnSystem(null)}
            className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border transition-all ${!focusSystem && !doubleClickSys ? "border-[var(--accent)] text-[var(--accent-glow)]" : "border-[#0d1e35] text-[#334155] hover:border-[#1e3a5f]"}`}>
            ALL
          </button>
          {SYSTEMS.map((s) => (
            <button key={s.id}
              onClick={() => focusOnSystem(s.id)}
              className={`px-2 py-0.5 rounded text-[8px] font-mono uppercase tracking-wider border transition-all ${focusSystem === s.id || doubleClickSys === s.id ? "text-white font-bold" : "border-[#0d1e35] text-[#334155] hover:border-[#1e3a5f]"}`}
              style={focusSystem === s.id || doubleClickSys === s.id ? { borderColor: s.accent, color: s.accent, background: s.accent + "1c" } : {}}>
              {s.label}
            </button>
          ))}

          {/* Legend */}
          <div className="ml-auto flex items-center gap-3">
            {(Object.entries(STATUS) as [NodeStatus, typeof STATUS[NodeStatus]][]).map(([, v]) => (
              <div key={v.label} className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-sm border" style={{ borderColor: v.stroke, background: v.glassTop }} />
                <span className="text-[7px] font-mono text-[#334155] uppercase">{v.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ── SVG Canvas ── */}
        <svg
          ref={svgRef}
          width="100%"
          height="100%"
          viewBox={`0 0 ${W} ${H}`}
          onMouseDown={handleSvgMouseDown}
          onMouseMove={handleSvgMouseMove}
          onMouseUp={handleSvgMouseUp}
          onMouseLeave={handleSvgMouseUp}
          onWheel={handleWheel}
          style={{ display: "block" }}
        >
          <defs>
            {/* Arrow markers */}
            {[
              { id: "arr-dim",    color: "#3b82f6", op: 0.5  },
              { id: "arr-bright", color: "#60a5fa", op: 1    },
              { id: "arr-green",  color: "#10b981", op: 0.95 },
              { id: "arr-amber",  color: "#f59e0b", op: 0.95 },
              { id: "arr-red",    color: "#ef4444", op: 0.95 },
            ].map(({ id, color, op }) => (
              <marker key={id} id={id} markerWidth="7" markerHeight="7" refX="5.5" refY="3.5" orient="auto">
                <path d="M0,0.5 L0,6.5 L6,3.5 z" fill={color} opacity={op} />
              </marker>
            ))}
            {/* Background gradient */}
            <radialGradient id="bgGrad" cx="50%" cy="50%" r="65%">
              <stop offset="0%"   stopColor="#071020" />
              <stop offset="60%"  stopColor="#04080f" />
              <stop offset="100%" stopColor="#02040a" />
            </radialGradient>
            {/* Vignette */}
            <radialGradient id="vigGrad" cx="50%" cy="50%" r="70%">
              <stop offset="50%"  stopColor="transparent" />
              <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
            </radialGradient>
            {/* Node glow filter */}
            <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
            {/* Soft glow filter for rings */}
            <filter id="softGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>

          {/* Background */}
          <rect width={W} height={H} fill="url(#bgGrad)" />

          {/* Fine grid */}
          {Array.from({ length: Math.ceil(W / 40) }, (_, i) => (
            <line key={`gx${i}`} x1={i * 40} y1={0} x2={i * 40} y2={H} stroke="#060e1c" strokeWidth={0.4} />
          ))}
          {Array.from({ length: Math.ceil(H / 40) }, (_, i) => (
            <line key={`gy${i}`} x1={0} y1={i * 40} x2={W} y2={i * 40} stroke="#060e1c" strokeWidth={0.4} />
          ))}

          {/* Stars */}
          {STARS.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="white" opacity={s.o}>
              {s.twinkle && (
                <animate attributeName="opacity" values={`${s.o};${s.o * 0.3};${s.o}`} dur={`${3 + (i % 5)}s`} repeatCount="indefinite" />
              )}
            </circle>
          ))}

          {/* HUD corner labels */}
          {([
            ["ENPLANIT/DTwin-v2", 14, 14, "start"],
            [simActive ? "● SIM MODE" : "● NOMINAL", W - 14, 14, "end"],
            [`${String(allNodes.length).padStart(3,"0")} NODES · ${String(edges.length).padStart(3,"0")} LINKS`, 14, H - 10, "start"],
            [`SCALE ${transform.scale.toFixed(2)}×`, W - 14, H - 10, "end"],
          ] as [string, number, number, "start"|"end"][]).map(([t, x, y, a]) => (
            <text key={t} x={x} y={y} textAnchor={a} fontSize={7} fontFamily="'Courier New',monospace"
              fill={t.includes("SIM") ? "#f59e0b" : "#1e3a5f"} letterSpacing="0.5">
              {t}
            </text>
          ))}

          {/* Main transform group — Centered at (CX, CY) so zoom expands symmetrically from the core */}
          <g transform={`translate(${transform.x},${transform.y}) translate(${CX},${CY}) scale(${transform.scale}) translate(${-CX},${-CY})`}>

            {/* Orbital ring decorations */}
            <circle cx={CX} cy={CY} r={R1 - 10} fill="none" stroke="#061425" strokeWidth={0.5} strokeDasharray="2 14" />
            <circle cx={CX} cy={CY} r={R1}      fill="none" stroke="#0e2a4a" strokeWidth={1}   strokeDasharray="4 10" />
            <circle cx={CX} cy={CY} r={R2}      fill="none" stroke="#0a2240" strokeWidth={1}   strokeDasharray="3 14" />
            <circle cx={CX} cy={CY} r={R2 + 60} fill="none" stroke="#061226" strokeWidth={0.6} />
            <circle cx={CX} cy={CY} r={R2 + 90} fill="none" stroke="#040c1a" strokeWidth={0.4} strokeDasharray="1 20" />

            {/* Orbital zone labels */}
            <text x={CX} y={CY - R1 + 14} textAnchor="middle" fontSize={6} fontFamily="'Courier New',monospace" fill="#1e3a5f" letterSpacing="0.1em" opacity={0.65}>
              ── INNER SUBSYSTEM ORBIT · 190 KM ──
            </text>
            <text x={CX} y={CY - R2 + 14} textAnchor="middle" fontSize={6} fontFamily="'Courier New',monospace" fill="#162c4a" letterSpacing="0.1em" opacity={0.55}>
              ── OUTER TELEMETRY ORBIT · 340 KM ──
            </text>

            {/* Ambient calm 90s radar scan line */}
            <g transform={`translate(${CX},${CY})`}>
              <line x1={0} y1={0} x2={R2 + 80} y2={0} stroke="rgba(6,182,212,0.22)" strokeWidth={1} strokeDasharray="3 8">
                <animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="90s" repeatCount="indefinite" />
              </line>
            </g>

            {/* Degree markers on outer ring */}
            {Array.from({ length: 36 }, (_, i) => {
              const a = i * 10;
              const isMajor = a % 90 === 0;
              const rad = (a * Math.PI) / 180;
              const rIn = R2 + (isMajor ? -8 : -4);
              const rOut = R2 + (isMajor ? 12 : 6);
              const x1 = CX + Math.cos(rad) * rIn;
              const y1 = CY + Math.sin(rad) * rIn;
              const x2 = CX + Math.cos(rad) * rOut;
              const y2 = CY + Math.sin(rad) * rOut;
              return (
                <g key={`deg_${a}`}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={isMajor ? "#1e3a5f" : "#0d1e35"} strokeWidth={isMajor ? 1 : 0.5} />
                  {isMajor && (
                    <text
                      x={CX + Math.cos(rad) * (R2 + 20)}
                      y={CY + Math.sin(rad) * (R2 + 20)}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontSize={5.5}
                      fontFamily="'Courier New',monospace"
                      fill="#1e3a5f"
                    >
                      {a}°
                    </text>
                  )}
                </g>
              );
            })}

            {/* Ghost Orbit lines to home coordinates (when dragged) */}
            <g>
              {Object.entries(nodePositions).map(([id, p]) => {
                const orig = positions[id];
                if (!orig) return null;
                const dist = Math.hypot(p.x - orig.x, p.y - orig.y);
                if (dist < 5) return null;
                return (
                  <g key={`tether_${id}`} style={{ pointerEvents: "none" }}>
                    <line
                      x1={orig.x} y1={orig.y}
                      x2={p.x} y2={p.y}
                      stroke="#06b6d4"
                      strokeWidth={1}
                      strokeDasharray="2 4"
                      opacity={0.65}
                    />
                    <circle cx={orig.x} cy={orig.y} r={2.5} fill="#06b6d4" opacity={0.5} />
                  </g>
                );
              })}
            </g>

            {/* Edges — bottom layer */}
            <g>{edges.map(renderEdge)}</g>

            {/* Nodes — top layer */}
            <g>{allNodes.map(renderNode)}</g>

            {/* Interactive Hover HUD Card */}
            {hovered && (() => {
              const node = allNodes.find((n) => n.id === hovered);
              if (!node) return null;
              const p = pos(node.id);
              const cfg = STATUS[node.status];
              const upCount = edges.filter((e) => e.target === node.id).length;
              const downCount = edges.filter((e) => e.source === node.id).length;
              const simVal = node.scenarioKey ? simValues[node.scenarioKey] : undefined;

              return (
                <g
                  transform={`translate(${p.x},${p.y - (node.kind === "mission" ? 44 : node.kind === "system" ? 38 : 32)})`}
                  style={{ pointerEvents: "none" }}
                >
                  {/* Card Background */}
                  <rect
                    x={-75} y={-32}
                    width={150} height={38}
                    rx={6}
                    fill="rgba(4,10,24,0.95)"
                    stroke={cfg.stroke}
                    strokeWidth={1.2}
                    filter="url(#softGlow)"
                  />
                  {/* Header: Status & Subsystem */}
                  <text x={-66} y={-28} fontSize={6} fontFamily="'Courier New',monospace" fill={cfg.stroke} fontWeight="700">
                    ● {cfg.label.toUpperCase()} · {node.kind.toUpperCase()}
                  </text>
                  {/* Title */}
                  <text x={-66} y={-16} fontSize={7.5} fontFamily="'Courier New',monospace" fill="#f8fafc" fontWeight="800">
                    {node.label.slice(0, 18)}
                  </text>
                  {/* Value & links */}
                  <text x={-66} y={-6} fontSize={6} fontFamily="'Courier New',monospace" fill="#94a3b8">
                    {simVal !== undefined ? `SIM: ${simVal}` : node.value ? `Val: ${String(node.value).slice(0, 10)}` : "No val"} · {upCount}↑ {downCount}↓
                  </text>
                </g>
              );
            })()}
          </g>

          {/* Vignette overlay */}
          <rect width={W} height={H} fill="url(#vigGrad)" style={{ pointerEvents: "none" }} />
        </svg>
      </div>

      {/* ════════════════════ TELEMETRY PANEL ════════════════════ */}
      <div
        className="flex-shrink-0 flex flex-col border-l overflow-hidden select-text h-full max-h-full"
        onMouseDown={(e) => e.stopPropagation()}
        onMouseMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        style={{
          width: 280,
          background: "linear-gradient(to bottom,#040a14,#030710)",
          borderColor: "#0d1e35",
          height: isFullscreen ? "100vh" : 640,
          maxHeight: isFullscreen ? "100vh" : 640,
        }}
      >
        {/* Panel header */}
        <div className="px-4 py-2.5 border-b border-[#0d1e35] flex items-center gap-2 shrink-0"
          style={{ background: "linear-gradient(to bottom,rgba(3,6,14,0.9),rgba(3,6,14,0.5))" }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <circle cx="6" cy="6" r="5" stroke="#3b82f6" strokeWidth="1.2" />
            <circle cx="6" cy="6" r="2" fill="#3b82f6" />
            <line x1="1" y1="6" x2="3.5" y2="6" stroke="#3b82f6" strokeWidth="1" />
            <line x1="8.5" y1="6" x2="11" y2="6" stroke="#3b82f6" strokeWidth="1" />
            <line x1="6" y1="1" x2="6" y2="3.5" stroke="#3b82f6" strokeWidth="1" />
            <line x1="6" y1="8.5" x2="6" y2="11" stroke="#3b82f6" strokeWidth="1" />
          </svg>
          <span className="text-[10px] font-mono uppercase tracking-widest text-[var(--accent-glow)]">
            Mission Telemetry
          </span>
          {(selected || selectedEdge) && (
            <button
              onClick={() => { setSelected(null); setSelectedEdge(null); }}
              className="ml-auto text-[10px] font-mono text-[#334155] hover:text-white transition-colors"
            >
              ✕
            </button>
          )}
        </div>

        {/* Panel body */}
        {!selectedNode && !selectedEdge && renderTelemetryEmpty()}
        {selectedEdge && !selectedNode && renderEdgeTelemetry(selectedEdge)}
        {selectedNode && renderNodeTelemetry(selectedNode)}
      </div>
    </div>
  );
}
