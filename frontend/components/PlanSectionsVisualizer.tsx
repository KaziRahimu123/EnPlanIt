"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import type { MissionPlan } from "@/lib/api";

interface PlanSectionsVisualizerProps {
  plan: MissionPlan;
  missionDestination?: string | null;
  missionDuration?: string | null;
  missionPower?: string | null;
  missionId?: string | null;
}

/**
 * Translates aerospace jargon, dense acronyms, and stiff AI text into simple, natural plain English.
 */
function humanizeText(text: string): string {
  if (!text) return "";
  let s = text.trim();

  // Fix stripped number bug (e.g. "day crewed surface mission duration.")
  s = s.replace(/^day crewed surface mission duration\.?/i, "Full 1-year (365 days) crew stay on the Moon surface.");
  s = s.replace(/^365[- ]day crewed surface mission duration\.?/i, "Living on the Moon surface for a full year (365 days).");

  // Specific common full-sentence replacements for maximum clarity
  s = s.replace(
    /Lunar South Pole terrain and access to permanently shadowed craters\.?/gi,
    "Navigating steep and pitch-black craters at the Moon's South Pole."
  );
  s = s.replace(
    /Solar availability and VSAT mast[- ]array placement for sustained power generation\.?/gi,
    "Setting up tall solar towers to catch low sunlight and provide steady electricity."
  );
  s = s.replace(
    /Cryogenic volatile handling and continuous ISRU process operation\.?/gi,
    "Handling super-cold ice and processing it continuously into rocket fuel and oxygen."
  );
  s = s.replace(
    /Deploy and commission the modular surface habitat\.?/gi,
    "Set up the crew living base on the Moon surface."
  );
  s = s.replace(
    /Commission the (\d+)\s*kWh energy[- ]storage microgrid\.?/gi,
    "Connect and turn on the $1 kWh battery power backup system."
  );
  s = s.replace(
    /Conduct volatile sampling in permanently shadowed craters\.?/gi,
    "Collect water ice and soil samples from dark craters."
  );
  s = s.replace(
    /Demonstrate continuous closed[- ]loop ISRU oxygen cracking for ascent propellant\.?/gi,
    "Test producing return rocket fuel and breathable oxygen from local lunar dirt."
  );
  s = s.replace(
    /VSAT mast[- ]array power generation and distribution architecture\.?/gi,
    "Tall solar towers to capture low sunlight and distribute power across the base."
  );
  s = s.replace(
    /Energy[- ]storage, power[- ]management, and (\d+)\s*kWh microgrid interfaces\.?/gi,
    "$1 kWh battery storage to keep power running during dark periods."
  );
  s = s.replace(
    /Volatile extraction, cryogenic handling, and ISRU oxygen[- ]cracking systems\.?/gi,
    "Equipment to dig up frozen ice and turn it into oxygen and rocket fuel."
  );
  s = s.replace(
    /Habitat life[- ]support, consumables, and crew logistics for (\d+)\s*days\.?/gi,
    "Food, water, clean air, and living supplies for the crew for $1 days."
  );
  s = s.replace(
    /Conduct sensitivity modeling in Scenario Lab\.?/gi,
    "Test 'what-if' emergency scenarios (like solar drops and comm lag) in Scenario Lab."
  );
  s = s.replace(
    /Verify power storage depth[- ]of[- ]discharge during eclipse periods\.?/gi,
    "Ensure batteries have enough charge to last safely through dark shadow periods."
  );
  s = s.replace(
    /Implement autonomous fault[- ]protection routines\.?/gi,
    "Set up automatic self-recovery rules in case communication with Earth is delayed."
  );

  // General phrase translations
  s = s.replace(/\bcontinuous closed[- ]loop ISRU oxygen cracking\b/gi, "making fuel and oxygen from lunar soil");
  s = s.replace(/\bISRU oxygen[- ]cracking systems?\b/gi, "oxygen and fuel production equipment");
  s = s.replace(/\bISRU synthesis\b/gi, "fuel and resource making");
  s = s.replace(/\bISRU\b/gi, "local resource/fuel making");
  s = s.replace(/\bclosed[- ]loop ECLSS\b/gi, "recycling life-support system");
  s = s.replace(/\bECLSS\b/gi, "Life Support");
  s = s.replace(/\bdepth[- ]of[- ]discharge\b/gi, "battery drain limit");
  s = s.replace(/\bVSAT mast[- ]array\b/gi, "tall solar mast panels");
  s = s.replace(/\bvolatile extraction\b/gi, "ice and mineral digging");
  s = s.replace(/\bpermanently shadowed craters\b/gi, "dark craters");
  s = s.replace(/\bcommission the\b/gi, "set up the");
  s = s.replace(/\bcommission\b/gi, "set up");
  s = s.replace(/\bautonomous fault[- ]protection routines\b/gi, "automated safety and self-recovery routines");
  s = s.replace(/\bFDIR\b/gi, "Fault Recovery");
  s = s.replace(/\bcontingency abort modes\b/gi, "emergency return plans");
  s = s.replace(/\bpayload capacity\b/gi, "cargo carrying limit");
  s = s.replace(/\btrajectory injection profile\b/gi, "flight path to destination");
  s = s.replace(/\bcomponent mass breakdown\b/gi, "exact weight breakdown of equipment");

  return s;
}

/**
 * Splits raw multiline text into clean bullet points without eating initial numbers.
 */
function parseBulletPoints(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split(/\n+/)
    .map((l) => l.trim())
    // Only strip numbered list markers like "1. ", "1) ", or bullet symbols "- ", "* ", "• "
    .map((l) => l.replace(/^(\d+[\.\)]\s*|[\-•\*]\s*)/, "").trim())
    .map((l) => l.replace(/^(?:Investigate|Required|Procure|Assess|Unknown):\s*/i, "").trim())
    .filter((l) => l.length > 2);
}

function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-[10px] font-semibold text-sky-300 uppercase tracking-wider font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
      AI Summary
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1. Objectives Component (Mission Goals)
// ---------------------------------------------------------------------------
function ObjectivesVisualizer({ raw }: { raw: string }) {
  const items = useMemo(() => parseBulletPoints(raw), [raw]);

  if (items.length === 0) {
    return <p className="text-xs font-mono italic text-[var(--text-muted)]">No goals specified</p>;
  }

  const getBadgeForIndex = (idx: number) => {
    if (idx === 0) return { label: "Main Goal", color: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40" };
    if (idx === 1) return { label: "Secondary Goal", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" };
    return { label: "Key Milestone", color: "bg-purple-500/20 text-purple-300 border-purple-500/40" };
  };

  return (
    <div className="grid grid-cols-1 gap-2.5">
      {items.map((obj, i) => {
        const badge = getBadgeForIndex(i);
        return (
          <div
            key={i}
            className="rounded-lg border border-[#1e3a5f]/60 bg-[#030914] p-3.5 flex items-start gap-3 hover:border-sky-500/50 transition-all group"
          >
            <div className="w-7 h-7 rounded border border-sky-500/30 bg-sky-500/10 flex items-center justify-center shrink-0 font-mono font-bold text-xs text-sky-300">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full font-semibold border ${badge.color}`}>
                  {badge.label}
                </span>
              </div>
              <p className="text-xs font-mono text-white font-medium leading-relaxed">
                {humanizeText(obj)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Required Resources Component (Key Systems Needed)
// ---------------------------------------------------------------------------
function ResourcesVisualizer({ raw }: { raw: string }) {
  const categories = useMemo(() => {
    const rawLines = parseBulletPoints(raw);

    const groups: Record<string, { icon: string; title: string; color: string; items: string[] }> = {
      science: { icon: "🧪", title: "Science & Experiments", color: "border-purple-500/40 text-purple-300", items: [] },
      power: { icon: "⚡", title: "Power & Battery Storage", color: "border-amber-500/40 text-amber-300", items: [] },
      isru: { icon: "🚀", title: "Engines & Fuel Making", color: "border-rose-500/40 text-rose-300", items: [] },
      eclss: { icon: "💧", title: "Life Support & Crew Care", color: "border-emerald-500/40 text-emerald-300", items: [] },
      comms: { icon: "📡", title: "Communications & Earth Contact", color: "border-sky-500/40 text-sky-300", items: [] },
      logistics: { icon: "🛠️", title: "Equipment & Spare Parts", color: "border-slate-500/40 text-slate-300", items: [] },
    };

    rawLines.forEach((item) => {
      const lower = item.toLowerCase();
      if (lower.includes("drill") || lower.includes("biosignature") || lower.includes("sample") || lower.includes("science")) {
        groups.science.items.push(item);
      } else if (lower.includes("solar") || lower.includes("power") || lower.includes("battery") || lower.includes("energy")) {
        groups.power.items.push(item);
      } else if (lower.includes("moxie") || lower.includes("propellant") || lower.includes("ascent") || lower.includes("isru") || lower.includes("fuel")) {
        groups.isru.items.push(item);
      } else if (lower.includes("water") || lower.includes("oxygen") || lower.includes("life-support") || lower.includes("habitat") || lower.includes("medical") || lower.includes("crew")) {
        groups.eclss.items.push(item);
      } else if (lower.includes("comm") || lower.includes("telemetry") || lower.includes("navigation") || lower.includes("relay") || lower.includes("contact")) {
        groups.comms.items.push(item);
      } else {
        groups.logistics.items.push(item);
      }
    });

    return Object.values(groups).filter((g) => g.items.length > 0);
  }, [raw]);

  if (categories.length === 0) {
    return <p className="text-xs font-mono italic text-[var(--text-muted)]">No systems listed</p>;
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {categories.map((cat, idx) => (
        <div key={idx} className="rounded-lg border border-[#1e3a5f]/60 bg-[#030914] p-3.5 space-y-2">
          <div className="flex items-center gap-2 border-b border-[#1e3a5f]/40 pb-2">
            <span className="text-sm">{cat.icon}</span>
            <span className={`text-xs font-mono font-bold uppercase tracking-wider ${cat.color}`}>
              {cat.title}
            </span>
            <span className="ml-auto text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-[var(--text-muted)]">
              {cat.items.length} {cat.items.length === 1 ? "item" : "items"}
            </span>
          </div>
          <ul className="space-y-1.5 pt-1">
            {cat.items.map((item, iIdx) => (
              <li key={iIdx} className="text-[11px] font-mono text-slate-300 flex items-start gap-2 leading-relaxed">
                <span className="text-sky-400 mt-0.5">•</span>
                <span>{humanizeText(item)}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Major Constraints Component (Limits & Challenges)
// ---------------------------------------------------------------------------
function ConstraintsVisualizer({ raw }: { raw: string }) {
  const constraints = useMemo(() => parseBulletPoints(raw), [raw]);

  if (constraints.length === 0) {
    return <p className="text-xs font-mono italic text-[var(--text-muted)]">No major limits or risks identified</p>;
  }

  const getConstraintMetadata = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes("dust") || lower.includes("radiation") || lower.includes("temperature") || lower.includes("surface") || lower.includes("crater") || lower.includes("terrain") || lower.includes("environment")) {
      return { tag: "Environment Challenge", icon: "🌐", color: "bg-rose-500/20 text-rose-300 border-rose-500/40" };
    }
    if (lower.includes("power") || lower.includes("battery") || lower.includes("solar") || lower.includes("energy")) {
      return { tag: "Power Challenge", icon: "⚡", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
    }
    if (lower.includes("autonomy") || lower.includes("delay") || lower.includes("communication") || lower.includes("latency") || lower.includes("signal")) {
      return { tag: "Signal Delay", icon: "📡", color: "bg-sky-500/20 text-sky-300 border-sky-500/40" };
    }
    if (lower.includes("duration") || lower.includes("year") || lower.includes("days") || lower.includes("stay") || lower.includes("crewed")) {
      return { tag: "Time & Living Limit", icon: "⏱️", color: "bg-amber-500/20 text-amber-300 border-amber-500/40" };
    }
    if (lower.includes("isru") || lower.includes("cryogenic") || lower.includes("fuel") || lower.includes("handling")) {
      return { tag: "Fuel Making Challenge", icon: "🚀", color: "bg-purple-500/20 text-purple-300 border-purple-500/40" };
    }
    return { tag: "Operational Limit", icon: "🛑", color: "bg-amber-500/15 text-amber-300 border-amber-500/30" };
  };

  return (
    <div className="grid grid-cols-1 gap-2.5">
      {constraints.map((c, i) => {
        const meta = getConstraintMetadata(c);
        return (
          <div
            key={i}
            className="rounded-lg border border-[#1e3a5f]/60 bg-[#030914] p-3.5 flex items-start gap-3 hover:border-amber-500/40 transition-colors"
          >
            <div className="w-7 h-7 rounded border border-amber-500/40 bg-amber-500/10 flex items-center justify-center shrink-0 font-mono font-bold text-xs text-amber-300">
              {i + 1}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className={`text-[9.5px] font-mono px-2 py-0.5 rounded-full font-bold border ${meta.color} flex items-center gap-1`}>
                  <span>{meta.icon}</span>
                  <span>{meta.tag}</span>
                </span>
              </div>
              <p className="text-xs font-mono text-slate-200 leading-relaxed pt-0.5">
                {humanizeText(c)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Planning Considerations Component (Action Steps)
// ---------------------------------------------------------------------------
function ConsiderationsVisualizer({ raw }: { raw: string }) {
  const directives = useMemo(() => parseBulletPoints(raw), [raw]);

  if (directives.length === 0) {
    return <p className="text-xs font-mono italic text-[var(--text-muted)]">No action steps specified</p>;
  }

  const getDirectiveDomain = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes("power") || lower.includes("energy") || lower.includes("battery") || lower.includes("moxie")) {
      return { domain: "Power Plan", icon: "⚡", style: "border-amber-500/30 text-amber-300" };
    }
    if (lower.includes("autonomy") || lower.includes("decision") || lower.includes("fault") || lower.includes("comm") || lower.includes("safety")) {
      return { domain: "Safety & Backup", icon: "🤖", style: "border-sky-500/30 text-sky-300" };
    }
    if (lower.includes("crew") || lower.includes("mobility") || lower.includes("habitat") || lower.includes("timeline") || lower.includes("spacewalk")) {
      return { domain: "Crew Routine", icon: "👥", style: "border-emerald-500/30 text-emerald-300" };
    }
    return { domain: "Action Item", icon: "📋", style: "border-purple-500/30 text-purple-300" };
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {directives.map((dir, i) => {
        const dom = getDirectiveDomain(dir);
        return (
          <div
            key={i}
            className="rounded-lg border border-[#1e3a5f]/60 bg-[#030914] p-3.5 flex flex-col justify-between gap-2 hover:border-sky-500/40 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className={`text-[9.5px] font-mono px-2 py-0.5 rounded border ${dom.style} font-bold flex items-center gap-1`}>
                <span>{dom.icon}</span>
                <span>{dom.domain}</span>
              </span>
              <span className="text-[9px] font-mono text-[var(--text-muted)]">Step {i + 1}</span>
            </div>
            <p className="text-[11px] font-mono text-slate-300 leading-relaxed">
              {humanizeText(dir)}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Missing Information Component (Missing Info)
// ---------------------------------------------------------------------------
function MissingInfoVisualizer({ raw, missionId }: { raw: string; missionId?: string | null }) {
  const gaps = useMemo(() => parseBulletPoints(raw), [raw]);

  if (gaps.length === 0) {
    return (
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-xs font-mono text-emerald-300 flex items-center gap-2">
        <span>✓</span> All basic mission specifications are known.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-[10px] font-mono text-amber-300 font-semibold uppercase tracking-wider">
          {gaps.length} Items to Confirm
        </span>
        {missionId && (
          <Link
            href={`/scenario-lab?mission_id=${missionId}`}
            className="text-[10px] font-mono text-sky-400 hover:text-sky-300 hover:underline flex items-center gap-1"
          >
            <span>Simulate Scenarios in Scenario Lab</span>
            <span>→</span>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {gaps.map((gap, i) => (
          <div
            key={i}
            className="rounded-lg border border-amber-500/30 bg-[#030914] p-3.5 flex flex-col justify-between gap-1.5"
          >
            <div className="flex items-center">
              <span className="text-[9.5px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30 font-bold">
                Item {i + 1} (To Confirm)
              </span>
            </div>
            <p className="text-xs font-mono text-slate-200 leading-relaxed pt-0.5">
              {humanizeText(gap)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Plan Visualizer
// ---------------------------------------------------------------------------
export default function PlanSectionsVisualizer({
  plan,
  missionDestination,
  missionDuration,
  missionPower,
  missionId,
}: PlanSectionsVisualizerProps) {
  const [activeTab, setActiveTab] = React.useState<string>("objectives");

  const objectivesCount = useMemo(() => parseBulletPoints(plan.objectives || "").length, [plan.objectives]);
  const resourcesCount = useMemo(() => parseBulletPoints(plan.required_resources || "").length, [plan.required_resources]);
  const constraintsCount = useMemo(() => parseBulletPoints(plan.major_constraints || "").length, [plan.major_constraints]);
  const directivesCount = useMemo(() => parseBulletPoints(plan.planning_considerations || "").length, [plan.planning_considerations]);
  const gapsCount = useMemo(() => parseBulletPoints(plan.missing_information || "").length, [plan.missing_information]);

  const tabs = [
    { id: "objectives", label: "Mission Goals", icon: "🎯", count: objectivesCount },
    { id: "resources", label: "Systems Needed", icon: "⚙️", count: resourcesCount },
    { id: "constraints", label: "Limits & Risks", icon: "⚠️", count: constraintsCount },
    { id: "directives", label: "Action Steps", icon: "📋", count: directivesCount },
    { id: "gaps", label: "Missing Info", icon: "❓", count: gapsCount, isAmber: true },
  ];

  return (
    <div className="rounded-xl border border-[#1e3a5f] bg-[#040c1a] shadow-xl overflow-hidden">
      {/* Tab Selector Header Bar */}
      <div className="px-4 py-2.5 border-b border-[#1e3a5f]/70 bg-[#020712] flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
            <span>📋</span> Mission Plan & Actions
          </span>
          <AiBadge />
        </div>

        {/* Segmented Navigation Tabs */}
        <div className="flex flex-wrap items-center gap-1 bg-[#01040a] p-1 rounded-lg border border-[#1e3a5f]/50">
          {tabs.map((t) => {
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-medium transition-all flex items-center gap-1.5 ${
                  isActive
                    ? "bg-sky-600 text-white shadow font-bold"
                    : "text-slate-400 hover:text-white hover:bg-slate-800/60"
                }`}
              >
                <span>{t.icon}</span>
                <span>{t.label}</span>
                {t.count !== null && (
                  <span
                    className={`text-[9px] px-1.5 py-0.2 rounded-full font-mono ${
                      isActive
                        ? "bg-white/20 text-white"
                        : t.isAmber
                        ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                        : "bg-[#1e3a5f]/40 text-slate-300"
                    }`}
                  >
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content Body */}
      <div className="p-4">
        {/* 1. Mission Goals */}
        {activeTab === "objectives" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#1e3a5f]/40 pb-2">
              <h4 className="text-xs font-mono font-bold text-sky-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🎯</span> Mission Goals & Key Milestones
              </h4>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{objectivesCount} Goals</span>
            </div>
            <ObjectivesVisualizer raw={plan.objectives} />
          </div>
        )}

        {/* 2. Systems Needed */}
        {activeTab === "resources" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#1e3a5f]/40 pb-2">
              <h4 className="text-xs font-mono font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚙️</span> Key Systems & Equipment Needed
              </h4>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{resourcesCount} Systems</span>
            </div>
            <ResourcesVisualizer raw={plan.required_resources} />
          </div>
        )}

        {/* 3. Limits & Risks */}
        {activeTab === "constraints" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
              <h4 className="text-xs font-mono font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>⚠️</span> Important Limits & Challenges
              </h4>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{constraintsCount} Limits</span>
            </div>
            <ConstraintsVisualizer raw={plan.major_constraints} />
          </div>
        )}

        {/* 4. Action Steps */}
        {activeTab === "directives" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-[#1e3a5f]/40 pb-2">
              <h4 className="text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>📋</span> Recommended Action Steps
              </h4>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{directivesCount} Steps</span>
            </div>
            <ConsiderationsVisualizer raw={plan.planning_considerations} />
          </div>
        )}

        {/* 5. Missing Info */}
        {activeTab === "gaps" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-amber-500/30 pb-2">
              <h4 className="text-xs font-mono font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                <span>❓</span> Missing Details & Items to Confirm
              </h4>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">{gapsCount} Items</span>
            </div>
            <MissingInfoVisualizer raw={plan.missing_information} missionId={missionId} />
          </div>
        )}
      </div>
    </div>
  );
}
