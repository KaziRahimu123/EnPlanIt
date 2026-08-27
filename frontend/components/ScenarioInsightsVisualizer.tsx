"use client";

import React, { useMemo } from "react";
import type { ScenarioInsightsResponse } from "@/lib/api";

interface ScenarioInsightsVisualizerProps {
  insightsRes: ScenarioInsightsResponse | null;
}

function AiPulseBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-[10px] font-semibold text-sky-300 uppercase tracking-wider font-mono">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
      AI Summary
    </span>
  );
}

// ---------------------------------------------------------------------------
// 1. What Changed (Parameter Changes)
// ---------------------------------------------------------------------------
function WhatChangedCard({ text }: { text: string }) {
  const isUnchanged = text.toLowerCase().includes("no variables were changed") || text.toLowerCase().includes("no variables changed") || text.toLowerCase().includes("nominal baseline");

  const extractedPills = useMemo(() => {
    const matches: string[] = [];
    const varMatches = text.match(/(?:[A-Z][a-zA-Z\s]+(?:\([^\)]+\)|power|battery|consumption|delay|duration|resource|availability))\s*[^,\.;]+/gi);
    if (varMatches) {
      matches.push(...varMatches.slice(0, 4));
    }
    return matches;
  }, [text]);

  return (
    <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#030914] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🔄</span>
          <h3 className="text-xs font-mono font-bold text-sky-300 uppercase tracking-wider">
            Parameter Changes (What Changed)
          </h3>
        </div>
        {isUnchanged ? (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1">
            <span>🔒</span> Nominal Baseline
          </span>
        ) : (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold uppercase tracking-wider flex items-center gap-1">
            <span>⚡</span> Shift Detected
          </span>
        )}
      </div>

      <div className="p-3.5 rounded-lg border border-[#1e3a5f]/40 bg-[#01040a] text-xs font-mono text-slate-200 leading-relaxed">
        {text}
      </div>

      {extractedPills.length > 0 && !isUnchanged && (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {extractedPills.map((pill, i) => (
            <span
              key={i}
              className="text-[9px] font-mono px-2 py-0.5 rounded bg-sky-500/10 text-sky-300 border border-sky-500/30 font-medium"
            >
              {pill}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Why It Matters (Subsystem Physics & Impacts)
// ---------------------------------------------------------------------------
function WhyItMattersCard({ text }: { text: string }) {
  const telemetryPills = useMemo(() => {
    const matches: Array<{ label: string; value: string; icon: string }> = [];
    const supplyM = text.match(/(\d+(?:\.\d+)?\s*kwh(?:\s*daily|\s*supply)?)/i);
    const demandM = text.match(/(?:against|demand of)\s*(\d+(?:\.\d+)?\s*kwh)/i);
    const resM = text.match(/(\d{1,3}%\s*(?:resource|availability)?)/i);
    const delayM = text.match(/(\d+(?:\.\d+)?\s*(?:minutes?|min|s)\s*(?:delay|latency)?)/i);
    const durM = text.match(/(\d+(?:\.\d+)?\s*(?:days?|months?|sols?)\s*(?:duration)?)/i);

    if (supplyM) matches.push({ label: "Power Supply", value: supplyM[1], icon: "⚡" });
    if (demandM) matches.push({ label: "Power Draw", value: demandM[1], icon: "🔌" });
    if (resM) matches.push({ label: "Supplies", value: resM[1], icon: "💧" });
    if (delayM) matches.push({ label: "Comm Delay", value: delayM[1], icon: "📡" });
    if (durM) matches.push({ label: "Duration", value: durM[1], icon: "⏱️" });

    return matches;
  }, [text]);

  return (
    <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#030914] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">💡</span>
          <h3 className="text-xs font-mono font-bold text-amber-300 uppercase tracking-wider">
            Subsystem Physics (Why It Matters)
          </h3>
        </div>
        <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          System Link
        </span>
      </div>

      {telemetryPills.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {telemetryPills.map((p, idx) => (
            <div key={idx} className="rounded border border-[#1e3a5f]/50 bg-[#020712] p-2 text-center">
              <div className="text-[8.5px] font-mono text-[var(--text-muted)] uppercase flex items-center justify-center gap-1">
                <span>{p.icon}</span>
                <span className="truncate">{p.label}</span>
              </div>
              <div className="text-xs font-mono font-bold text-white mt-0.5 truncate">
                {p.value}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="p-3.5 rounded-lg border border-[#1e3a5f]/40 bg-[#01040a] text-xs font-mono text-slate-200 leading-relaxed">
        {text}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Possible Mission Impact (Operational Risk & Safety Runway)
// ---------------------------------------------------------------------------
function PossibleImpactCard({ text }: { text: string }) {
  const isHighRisk = text.toLowerCase().includes("high") || text.toLowerCase().includes("critical") || text.toLowerCase().includes("deficit") || text.toLowerCase().includes("depletion");
  const isMediumRisk = text.toLowerCase().includes("medium") || text.toLowerCase().includes("elevated") || text.toLowerCase().includes("moderate") || text.toLowerCase().includes("margin drop");

  return (
    <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#030914] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🛸</span>
          <h3 className="text-xs font-mono font-bold text-emerald-300 uppercase tracking-wider">
            Flight Safety & Runway (Mission Impact)
          </h3>
        </div>
        {isHighRisk ? (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-rose-500/40 bg-rose-500/10 text-rose-300 font-bold uppercase tracking-wider">
            Critical Impact
          </span>
        ) : isMediumRisk ? (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold uppercase tracking-wider">
            Moderate Adjustment
          </span>
        ) : (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 font-bold uppercase tracking-wider flex items-center gap-1">
            <span>✓</span> Safe Margins
          </span>
        )}
      </div>

      <div className="p-3.5 rounded-lg border border-emerald-500/30 bg-[#01040a] text-xs font-mono text-slate-200 leading-relaxed border-l-4">
        {text}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. What to Investigate Next (Action Items & Recommendations)
// ---------------------------------------------------------------------------
function InvestigateNextCard({ text }: { text: string }) {
  const directives = useMemo(() => {
    return text
      .split(/(?<=[.?!])\s+/)
      .map((s) => s.replace(/^[\s\-•\*\d\.\)]+/, "").trim())
      .filter((s) => s.length > 10);
  }, [text]);

  const getDirectiveTag = (sentence: string) => {
    const l = sentence.toLowerCase();
    if (l.includes("power") || l.includes("kwh") || l.includes("battery") || l.includes("supply")) {
      return { tag: "POWER CHECK", color: "border-amber-500/30 text-amber-300 bg-amber-500/10" };
    }
    if (l.includes("delay") || l.includes("comm") || l.includes("latency") || l.includes("ground")) {
      return { tag: "COMMS CHECK", color: "border-sky-500/30 text-sky-300 bg-sky-500/10" };
    }
    if (l.includes("resource") || l.includes("water") || l.includes("oxygen") || l.includes("isru")) {
      return { tag: "SUPPLIES AUDIT", color: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10" };
    }
    return { tag: "VERIFY STEP", color: "border-purple-500/30 text-purple-300 bg-purple-500/10" };
  };

  return (
    <div className="rounded-xl border border-[#1e3a5f]/60 bg-[#030914] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">🔬</span>
          <h3 className="text-xs font-mono font-bold text-purple-300 uppercase tracking-wider">
            Recommended Action Items (What to Check Next)
          </h3>
        </div>
        <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider">
          {directives.length} Steps
        </span>
      </div>

      <div className="space-y-2.5">
        {directives.map((dir, i) => {
          const meta = getDirectiveTag(dir);
          return (
            <div
              key={i}
              className="rounded-lg border border-[#1e3a5f]/40 bg-[#01040a] p-3 flex flex-col gap-1.5 hover:border-purple-500/40 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className={`text-[8.5px] font-mono px-2 py-0.5 rounded border font-bold uppercase tracking-wider ${meta.color}`}>
                  {meta.tag}
                </span>
                <span className="text-[9px] font-mono text-[var(--text-muted)]">Step {i + 1}</span>
              </div>
              <p className="text-xs font-mono text-slate-200 leading-relaxed pl-1 border-l border-purple-500/30">
                {dir}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AI Insights Visualizer
// ---------------------------------------------------------------------------
export default function ScenarioInsightsVisualizer({ insightsRes }: ScenarioInsightsVisualizerProps) {
  if (!insightsRes) return null;

  const raw = insightsRes.insights as any || {};

  const whatChanged =
    raw.what_changed ||
    raw.tradeoff_summary ||
    "Scenario parameters simulated against baseline specification.";

  const whyItMatters =
    raw.why_it_matters ||
    raw.key_observation ||
    "Modifying flight variables alters continuous power and life-support margins across subsystems.";

  const possibleImpact =
    raw.possible_mission_impact ||
    "Flight safety margins and survival autonomy buffers adjust in real time according to parameter stress.";

  const whatToInvestigate =
    raw.what_to_investigate_next ||
    raw.recommendation ||
    "Audit battery depth-of-discharge and confirm consumable replenishment schedule for extended durations.";

  return (
    <div className="rounded-xl border border-[#1e3a5f] bg-[#050f20] shadow-2xl overflow-hidden space-y-4 p-4 sm:p-5">
      {/* Header */}
      <div className="border-b border-[#1e3a5f]/80 pb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="shrink-0">
            <circle cx="7" cy="7" r="6" stroke="var(--accent-glow)" strokeWidth="1.2" />
            <circle cx="7" cy="7" r="2.5" fill="var(--accent-glow)" />
          </svg>
          <div>
            <h2 className="text-xs font-mono font-bold text-white uppercase tracking-widest">
              🧠 AI Scenario Analysis & Cognitive Assessment
            </h2>
            <span className="text-[10px] font-mono text-[var(--text-muted)]">
              Multi-subsystem impact modeling & sensitivity evaluation
            </span>
          </div>
        </div>
        <AiPulseBadge />
      </div>

      {/* 4 Interactive Assessment Modules in 2x2 Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3.5 items-start">
        <WhatChangedCard text={whatChanged} />
        <WhyItMattersCard text={whyItMatters} />
        <PossibleImpactCard text={possibleImpact} />
        <InvestigateNextCard text={whatToInvestigate} />
      </div>
    </div>
  );
}
