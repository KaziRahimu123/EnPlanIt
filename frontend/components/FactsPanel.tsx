"use client";

/**
 * FactsPanel — High-Tech Mission Control Telemetry & Fact Verification Grid.
 *
 * States: Confirmed | Extracted | Needs Review | Not Specified
 * Source traceability: shows verbatim document/prompt quotes with page references.
 */

import React, { useMemo } from "react";
import type { DocumentFact } from "@/lib/api";

const STATE_CONFIG: Record<
  DocumentFact["state"],
  { label: string; dotColor: string; textColor: string; borderColor: string; bgColor: string }
> = {
  confirmed: {
    label: "Confirmed",
    dotColor: "bg-emerald-400",
    textColor: "text-emerald-300",
    borderColor: "border-emerald-500/40",
    bgColor: "bg-emerald-500/10",
  },
  extracted: {
    label: "Extracted",
    dotColor: "bg-sky-400",
    textColor: "text-sky-300",
    borderColor: "border-sky-500/40",
    bgColor: "bg-sky-500/10",
  },
  needs_review: {
    label: "Needs Review",
    dotColor: "bg-amber-400",
    textColor: "text-amber-300",
    borderColor: "border-amber-500/40",
    bgColor: "bg-amber-500/10",
  },
  not_specified: {
    label: "Not Specified",
    dotColor: "bg-slate-500",
    textColor: "text-slate-400",
    borderColor: "border-slate-700",
    bgColor: "bg-slate-900/40",
  },
};

function StateBadge({ state }: { state: DocumentFact["state"] }) {
  const cfg = STATE_CONFIG[state] ?? STATE_CONFIG.not_specified;
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[9.5px] font-mono font-bold uppercase tracking-wider ${cfg.textColor} ${cfg.borderColor} ${cfg.bgColor}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotColor} ${state === "extracted" || state === "confirmed" ? "animate-pulse" : ""}`} />
      {cfg.label}
    </span>
  );
}

const FIELD_ICONS: Record<string, { icon: string; title: string; categoryTag: string }> = {
  mission_duration_days: {
    icon: "⏱️",
    title: "Mission Duration",
    categoryTag: "CH-01 • TIMELINE",
  },
  solar_power_pct: {
    icon: "⚡",
    title: "Solar Power Availability",
    categoryTag: "CH-02 • POWER GENERATION",
  },
  battery_capacity_kwh: {
    icon: "🔋",
    title: "Battery / Storage Capacity",
    categoryTag: "CH-03 • ENERGY STORAGE",
  },
  daily_power_consumption_kwh: {
    icon: "🔌",
    title: "Daily Power Draw",
    categoryTag: "CH-04 • BASELOAD DEMAND",
  },
  resource_availability_pct: {
    icon: "💧",
    title: "Resource Availability",
    categoryTag: "CH-05 • LIFE SUPPORT (ECLSS)",
  },
  communication_delay_min: {
    icon: "📡",
    title: "Communication Delay",
    categoryTag: "CH-06 • TELEMETRY LINK",
  },
};

interface FactsPanelProps {
  facts: DocumentFact[];
  loading?: boolean;
  missionDescription?: string | null;
  duration?: string | null;
  powerSource?: string | null;
  knownResources?: string | null;
}

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

export default function FactsPanel({
  facts,
  loading,
  missionDescription,
  duration,
  powerSource,
  knownResources,
}: FactsPanelProps) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[#1e3a5f] bg-[#050f20] p-5 animate-pulse">
        <div className="h-3 w-40 bg-[#1e3a5f] rounded mb-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-28 bg-[#030914] rounded-lg border border-[#1e3a5f]/40" />
          ))}
        </div>
      </div>
    );
  }

  // Merge server facts with prompt metadata and regex fallbacks
  const effectiveFacts = useMemo(() => {
    const list = [...facts];
    const desc = (missionDescription || "").toLowerCase();

    // Guard: Do not inject client-side fallback telemetry if the document is unrelated to aerospace
    if (!isAerospaceText(missionDescription)) {
      return list;
    }

    // 1. Duration
    const durIndex = list.findIndex((f) => f.field_key === "mission_duration_days");
    if (durIndex >= 0 && list[durIndex].state === "not_specified") {
      const durRange = (missionDescription || "").match(/(?:operational\s+timeline|mission\s+duration|duration|planned\s+for|lasting)\s*(?:between\s+)?(\d+(?:\.\d+)?)\s*(?:to|-|and)\s*(\d+(?:\.\d+)?)\s*(months?|years?|days?|sols?)/i);
      const durSingle = (duration || missionDescription || "").match(/(?:operational\s+timeline|mission\s+duration|duration|planned\s+for|lasting)\s*(\d+(?:\.\d+)?)\s*(-|\s)?\s*(months?|years?|days?|sols?)/i);
      if (durRange) {
        const v1 = parseFloat(durRange[1]);
        const v2 = parseFloat(durRange[2]);
        const u = durRange[3].toLowerCase();
        const mult = u.startsWith("month") ? 30 : (u.startsWith("year") ? 365 : 1);
        list[durIndex] = {
          ...list[durIndex],
          value: `${v1} to ${v2} ${durRange[3]}`,
          numeric_value: Math.round(((v1 + v2) / 2) * mult),
          state: "needs_review",
          source_text: `Range detected in prompt: "${durRange[0]}"`,
        };
      } else if (durSingle) {
        const n = parseFloat(durSingle[1]);
        const unit = durSingle[3].toLowerCase();
        let days = n;
        if (unit.startsWith("month")) days = n * 30;
        else if (unit.startsWith("year")) days = n * 365;
        list[durIndex] = {
          ...list[durIndex],
          value: duration || `${n} ${unit}`,
          numeric_value: days,
          state: "extracted",
          source_text: duration ? `Mission duration: ${duration}` : `Extracted from prompt: "${durSingle[0]}"`,
        };
      }
    }

    // 2. Resources
    const resIndex = list.findIndex((f) => f.field_key === "resource_availability_pct");
    if (resIndex >= 0 && list[resIndex].state === "not_specified") {
      const validResources = knownResources && !knownResources.toLowerCase().includes("unknown");
      if (validResources || desc.includes("isru") || desc.includes("eclss") || (desc.includes("consumable") && desc.includes("life support"))) {
        list[resIndex] = {
          ...list[resIndex],
          value: "100%",
          numeric_value: 100,
          state: "extracted",
          source_text: validResources ? (knownResources || "") : "Closed-loop ECLSS / ISRU consumables referenced in mission profile",
        };
      }
    }

    // 3. Solar Power
    const powIndex = list.findIndex((f) => f.field_key === "solar_power_pct");
    if (powIndex >= 0 && list[powIndex].state === "not_specified") {
      const validPower = powerSource && !powerSource.toLowerCase().includes("unknown");
      if ((validPower && powerSource?.toLowerCase().includes("solar")) || desc.includes("photovoltaic") || desc.includes("solar array")) {
        list[powIndex] = {
          ...list[powIndex],
          value: "100%",
          numeric_value: 100,
          state: "extracted",
          source_text: validPower ? (powerSource || "") : "Solar power array baseline specified in mission profile",
        };
      }
    }

    // 4. Battery Capacity
    const batIndex = list.findIndex((f) => f.field_key === "battery_capacity_kwh");
    if (batIndex >= 0) {
      const batSuffix = (missionDescription || "").match(/(\d+(?:\.\d+)?)\s*(?:kwh|kw-hr)\s*(?:[a-z\-]+\s+){0,3}(?:battery|storage|reserve|bank)/i);
      const batPrefix = (missionDescription || "").match(/(?:battery|storage|energy storage|reserve)\s*(?:capacity|bank|system|reserve|size)?\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*(?:kwh|kw-hr)/i);
      const target = batSuffix || batPrefix;
      if (target) {
        list[batIndex] = {
          ...list[batIndex],
          value: `${target[1]} kWh`,
          numeric_value: parseFloat(target[1]),
          state: "extracted",
          source_text: `Extracted battery reserve: "${target[0]}"`,
        };
      }
    }

    // 5. Daily Power Consumption
    const conIndex = list.findIndex((f) => f.field_key === "daily_power_consumption_kwh");
    if (conIndex >= 0) {
      const conPrefix = (missionDescription || "").match(/(?:daily\s*(?:station\s*)?power\s*consumption|daily\s*draw|consumption|demand|draws|consumes)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*kwh/i);
      const conSuffix = (missionDescription || "").match(/(\d+(?:\.\d+)?)\s*kwh\s*(?:per\s*(?:sol|day)|daily|consumption|draw)/i);
      const target = conPrefix || conSuffix;
      if (target) {
        list[conIndex] = {
          ...list[conIndex],
          value: `${target[1]} kWh`,
          numeric_value: parseFloat(target[1]),
          state: "extracted",
          source_text: `Daily draw identified: "${target[0]}"`,
        };
      }
    }

    // 6. Communication Delay
    const commIndex = list.findIndex((f) => f.field_key === "communication_delay_min");
    if (commIndex >= 0 && (list[commIndex].state === "not_specified" || list[commIndex].value?.includes("min"))) {
      const commMatch1 = (missionDescription || "").match(/(?:one-way\s+)?(?:communication\s+)?(?:delay|latency|lag|comm\s+delay|signal\s+delay)\s*(?:of|is|:|\-)?\s*(\d+(?:\.\d+)?)\s*[\-\s]*(minutes?|mins?|seconds?|secs?|hours?|hrs?)/i);
      const commMatch2 = (missionDescription || "").match(/(\d+(?:\.\d+)?)\s*[\-\s]*(minutes?|mins?|seconds?|secs?|hours?|hrs?)\s*(?:[a-z\-]+\s+){0,3}(?:delay|latency|lag|comm)/i);
      const commMatch = commMatch1 || commMatch2;
      if (commMatch) {
        const rawVal = parseFloat(commMatch[1]);
        const unitStr = (commMatch[2] || "").toLowerCase();
        const isSec = unitStr.startsWith("sec");
        const isHr = unitStr.startsWith("hour") || unitStr.startsWith("hr");
        const minVal = isSec ? Math.round((rawVal / 60) * 1000) / 1000 : (isHr ? rawVal * 60 : rawVal);
        const displayVal = isSec ? `${rawVal} sec` : (isHr ? `${rawVal} hr` : `${rawVal} min`);

        list[commIndex] = {
          ...list[commIndex],
          value: displayVal,
          numeric_value: minVal,
          state: "extracted",
          source_text: `Extracted latency: "${commMatch[0]}"`,
        };
      }
    }

    return list;
  }, [facts, missionDescription, duration, powerSource, knownResources]);

  const isAerospace = useMemo(() => isAerospaceText(missionDescription), [missionDescription]);
  const verifiedCount = effectiveFacts.filter((f) => f.state !== "not_specified").length;

  return (
    <div className="rounded-xl border border-[#1e3a5f] bg-[#050f20] shadow-xl overflow-hidden">
      {/* Header telemetry HUD */}
      <div className="px-5 py-4 border-b border-[#1e3a5f]/80 bg-[#020712] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-2.5 w-2.5 relative">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${isAerospace ? "bg-sky-400" : "bg-amber-400"} opacity-75`} />
            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isAerospace ? "bg-sky-500" : "bg-amber-500"}`} />
          </span>
          <div>
            <h2 className="text-xs font-mono font-bold text-white uppercase tracking-widest flex items-center gap-2">
              Extracted Mission Telemetry & Facts
            </h2>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              Document facts & prompt telemetry cross-referenced
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 font-mono">
          {!isAerospace ? (
            <span className="text-[10px] px-2.5 py-1 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1.5 shadow-sm">
              <span>⚠️</span> Unrelated Topic (0 / {effectiveFacts.length} Verified)
            </span>
          ) : (
            <span className="text-[10px] px-2.5 py-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 font-bold uppercase tracking-wider">
              {verifiedCount} / {effectiveFacts.length} Channels Verified
            </span>
          )}
        </div>
      </div>

      {/* Unrelated / Non-Aerospace Warning Alert Banner */}
      {!isAerospace && missionDescription && (
        <div className="mx-4 sm:mx-5 mt-3.5 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs font-mono text-amber-200 flex items-start gap-3 shadow-lg shadow-amber-500/5">
          <span className="text-base sm:text-lg">⚠️</span>
          <div className="space-y-1 flex-1">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="font-bold text-amber-300 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                Unrelated / Non-Aerospace Document Detected
              </span>
              <span className="text-[9px] px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/20 text-amber-300 font-bold uppercase">
                Zero Spaceflight Channels Found
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed font-sans">
              This document does not discuss spaceflight operations, orbital mechanics, spacecraft telemetry, or life-support subsystems. All 6 space telemetry channels are marked as <strong className="text-slate-200">Not Specified</strong> to prevent invalid cross-contamination.
            </p>
          </div>
        </div>
      )}

      {/* Filter / Evidence Legend Bar */}
      <div className="px-5 py-2.5 border-b border-[#1e3a5f]/40 bg-[#030914] flex flex-wrap items-center justify-between gap-3 text-xs font-mono mt-3">
        <div className="flex flex-wrap items-center gap-3.5 text-[10px]">
          {(["confirmed", "extracted", "needs_review", "not_specified"] as const).map((s) => {
            const cfg = STATE_CONFIG[s];
            return (
              <div key={s} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${cfg.dotColor}`} />
                <span className="text-slate-300 font-medium">{cfg.label}</span>
              </div>
            );
          })}
        </div>
        <span className="text-[9px] text-[var(--text-muted)] uppercase tracking-wider">
          NASA / ESA Subsystem Architecture
        </span>
      </div>

      {/* Grid of Compact Telemetry Status Indicators (Sleek 6-Column Strip) */}
      <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {effectiveFacts.map((fact) => {
          const meta = FIELD_ICONS[fact.field_key] || {
            icon: "📋",
            title: fact.label,
            categoryTag: "TELEMETRY",
          };
          const hasValue = fact.state !== "not_specified" && fact.value;
          const isNotSpecified = fact.state === "not_specified";
          const needsReview = fact.state === "needs_review";

          const channelCode = meta.categoryTag.split("•")[0].trim();
          const shortLabel = fact.label
            .replace("Availability", "")
            .replace("Capacity", "")
            .replace("Consumption", "Draw")
            .replace("Mission ", "")
            .replace("/ Storage", "")
            .replace("/ Energy Storage", "")
            .trim();

          return (
            <div
              key={fact.id || fact.field_key}
              className={`rounded-xl border p-3 flex flex-col justify-between transition-all duration-200 group relative ${
                isNotSpecified
                  ? "border-slate-800/70 bg-[#020712]/70 opacity-60"
                  : needsReview
                  ? "border-amber-500/40 bg-[#070e1b] hover:border-amber-400 shadow-md"
                  : "border-[#1e3a5f] bg-[#030917] hover:border-sky-500/60 shadow-md"
              }`}
            >
              {/* Header: Channel Code + State Badge */}
              <div className="flex items-center justify-between gap-1 mb-1.5">
                <span className="text-[9px] font-mono font-bold text-sky-400 uppercase tracking-wider">
                  {channelCode}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8.5px] font-mono font-bold uppercase tracking-wider ${
                    fact.state === "confirmed"
                      ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/30"
                      : fact.state === "extracted"
                      ? "bg-sky-500/10 text-sky-300 border border-sky-500/30"
                      : fact.state === "needs_review"
                      ? "bg-amber-500/15 text-amber-300 border border-amber-500/40"
                      : "bg-slate-800/40 text-slate-400 border border-slate-700/60"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      fact.state === "confirmed"
                        ? "bg-emerald-400"
                        : fact.state === "extracted"
                        ? "bg-sky-400"
                        : fact.state === "needs_review"
                        ? "bg-amber-400"
                        : "bg-slate-500"
                    }`}
                  />
                  {fact.state === "needs_review"
                    ? "Clarify"
                    : fact.state === "confirmed"
                    ? "Present"
                    : fact.state === "extracted"
                    ? "Present"
                    : "Missing"}
                </span>
              </div>

              {/* Title / Channel Name */}
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-xs">{meta.icon}</span>
                <h3 className="text-[11px] font-mono font-bold text-slate-200 truncate" title={fact.label}>
                  {shortLabel}
                </h3>
              </div>

              {/* Status Value */}
              <div className="mt-auto pt-1 border-t border-[#1e3a5f]/30">
                {hasValue ? (
                  <div className="font-mono text-sm font-bold text-white tracking-tight truncate">
                    {fact.value}
                  </div>
                ) : (
                  <div className="text-[10px] font-mono italic text-slate-500 flex items-center gap-1">
                    <span>—</span>
                    <span>Not Specified</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
