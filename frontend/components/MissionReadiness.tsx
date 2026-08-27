"use client";

/**
 * MissionReadiness
 *
 * Computes a 0–100 readiness score for each mission domain based solely on:
 *   - DocumentFact states (confirmed / extracted / needs_review / not_specified)
 *   - MissionExtracted field completeness
 *   - MissionPlan field completeness
 *
 * No random or hardcoded mission-specific values. The demo on the homepage
 * uses its own static data separate from this component.
 */

import { useState } from "react";
import type { DocumentFact, MissionExtracted, MissionPlan } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadinessInput {
  extracted: MissionExtracted | null;
  plan: MissionPlan | null;
  facts: DocumentFact[];
}

interface DomainScore {
  id: string;
  label: string;
  color: string;
  score: number;          // 0–100
  available: string[];
  missing: string[];
  needsReview: string[];
  risks: string[];
  loweredBy: string[];
}

// ─── Scoring helpers ──────────────────────────────────────────────────────────

function pctPresent(values: (string | null | undefined)[]): number {
  const filled = values.filter((v) => {
    const s = v != null ? String(v).trim() : "";
    return s !== "" && s.toLowerCase() !== "unknown";
  });
  return values.length === 0 ? 0 : Math.round((filled.length / values.length) * 100);
}

function factsForCategory(facts: DocumentFact[], category: string) {
  return facts.filter((f) => f.category === category);
}

function factsScore(catFacts: DocumentFact[]): {
  score: number;
  available: string[];
  missing: string[];
  needsReview: string[];
  risks: string[];
  loweredBy: string[];
} {
  if (catFacts.length === 0) {
    return { score: 0, available: [], missing: [], needsReview: [], risks: [], loweredBy: ["No document facts available for this domain"] };
  }

  const available: string[] = [];
  const missing: string[] = [];
  const needsReview: string[] = [];
  const risks: string[] = [];
  const loweredBy: string[] = [];

  let points = 0;
  const total = catFacts.length;

  catFacts.forEach((f) => {
    const label = f.label || f.field_key;
    switch (f.state) {
      case "confirmed":
        points += 1.0;
        available.push(`${label}${f.value ? `: ${f.value}${f.unit ? " " + f.unit : ""}` : ""}`);
        break;
      case "extracted":
        points += 0.7;
        available.push(`${label}${f.value ? `: ${f.value}${f.unit ? " " + f.unit : ""}` : ""} (extracted)`);
        break;
      case "needs_review":
        points += 0.3;
        needsReview.push(label);
        risks.push(`${label} needs verification before use`);
        loweredBy.push(`${label} flagged for review`);
        break;
      case "not_specified":
        missing.push(label);
        loweredBy.push(`${label} not specified in documents`);
        break;
    }
  });

  return {
    score: Math.round((points / total) * 100),
    available,
    missing,
    needsReview,
    risks,
    loweredBy,
  };
}

// ─── Domain definitions ───────────────────────────────────────────────────────

// Maps domain → { factCategory, extractedFields, planFields }
const DOMAINS: Array<{
  id: string;
  label: string;
  color: string;
  factCategory: string;
  extractedFields: (keyof MissionExtracted)[];
  planFields: (keyof MissionPlan)[];
}> = [
  {
    id: "definition",
    label: "Mission Definition",
    color: "#3b82f6",
    factCategory: "general",
    extractedFields: ["destination", "mission_type", "objective"],
    planFields: ["mission_summary", "objectives"],
  },
  {
    id: "power",
    label: "Power",
    color: "#06b6d4",
    factCategory: "power",
    extractedFields: ["power_source"],
    planFields: [],
  },
  {
    id: "resources",
    label: "Resources",
    color: "#f59e0b",
    factCategory: "resources",
    extractedFields: ["known_resources"],
    planFields: ["required_resources"],
  },
  {
    id: "crew",
    label: "Crew",
    color: "#10b981",
    factCategory: "general",   // crew facts fall under general
    extractedFields: [],
    planFields: [],
  },
  {
    id: "comms",
    label: "Communications",
    color: "#8b5cf6",
    factCategory: "communication",
    extractedFields: [],
    planFields: [],
  },
  {
    id: "constraints",
    label: "Constraints",
    color: "#ef4444",
    factCategory: "general",
    extractedFields: [],
    planFields: ["major_constraints", "planning_considerations", "missing_information"],
  },
];

// ─── Main score computation ───────────────────────────────────────────────────

export function computeReadiness(input: ReadinessInput): DomainScore[] {
  const { extracted, plan, facts } = input;

  return DOMAINS.map((domain) => {
    const catFacts = factsForCategory(facts, domain.factCategory).filter(
      (f) =>
        // Crew domain: filter for crew-related field keys
        domain.id === "crew"
          ? f.field_key?.includes("crew") || f.label?.toLowerCase().includes("crew")
          : domain.id === "constraints"
          ? f.field_key?.includes("constraint") || f.category === "general"
          : true
    );

    const factResult = factsScore(
      domain.id === "crew" || domain.id === "constraints" ? catFacts : catFacts
    );

    // Extracted fields completeness
    const extractedVals = domain.extractedFields.map((k) => extracted?.[k] ?? null);
    const extractedPct = domain.extractedFields.length > 0 ? pctPresent(extractedVals) : null;

    // Plan fields completeness
    const planVals = domain.planFields.map((k) => plan?.[k] ?? null);
    const planPct = domain.planFields.length > 0 ? pctPresent(planVals) : null;

    // Merge signals with weighted average
    const signals: number[] = [];
    if (catFacts.length > 0) signals.push(factResult.score);
    if (extractedPct !== null) signals.push(extractedPct);
    if (planPct !== null) signals.push(planPct);

    let score: number;
    if (signals.length === 0) {
      score = 0;
    } else {
      score = Math.round(signals.reduce((a, b) => a + b, 0) / signals.length);
    }

    // Append extracted-level diagnostics
    const available = [...factResult.available];
    const missing = [...factResult.missing];
    const loweredBy = [...factResult.loweredBy];

    domain.extractedFields.forEach((k) => {
      const val = extracted?.[k];
      const strVal = val != null ? String(val).trim() : "";
      const label = k.replace(/_/g, " ");
      if (strVal !== "" && strVal.toLowerCase() !== "unknown") {
        available.push(`${label}: ${strVal}`);
      } else {
        missing.push(label);
        loweredBy.push(`Extracted field "${label}" is unknown or missing`);
      }
    });

    domain.planFields.forEach((k) => {
      const val = plan?.[k];
      const label = k.replace(/_/g, " ");
      if (val && val.trim() !== "") {
        available.push(label);
      } else {
        missing.push(label);
        loweredBy.push(`Plan section "${label}" is empty`);
      }
    });

    // Overall risk hints
    const risks = [...factResult.risks];
    if (score < 40) risks.push("Low coverage — critical planning data is missing");
    if (score >= 40 && score < 70) risks.push("Partial coverage — some parameters need confirmation");

    return {
      id: domain.id,
      label: domain.label,
      color: domain.color,
      score,
      available: [...new Set(available)],
      missing: [...new Set(missing)],
      needsReview: factResult.needsReview,
      risks,
      loweredBy: [...new Set(loweredBy)],
    };
  });
}

// ─── SVG arc helper ───────────────────────────────────────────────────────────

// Single arc path helper (reused by gauge and page demo)
function arcPath(pct: number, cx: number, cy: number, radius: number): string {
  if (pct >= 100) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius}`;
  }
  if (pct <= 0) return "";
  const angle = (pct / 100) * 2 * Math.PI;
  const x = cx + radius * Math.sin(angle);
  const y = cy - radius * Math.cos(angle);
  return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 ${pct > 50 ? 1 : 0} 1 ${x} ${y}`;
}

// Consistent readiness-based color (not domain color)
function scoreColor(score: number): string {
  if (score >= 90) return "#10b981"; // green
  if (score >= 70) return "#3b82f6"; // blue
  if (score >= 40) return "#f59e0b"; // orange
  return "#ef4444";                  // red
}

function scoreLabel(score: number): string {
  if (score >= 90) return "HIGH READINESS";
  if (score >= 70) return "MODERATE READINESS";
  if (score >= 40) return "LOW READINESS";
  return "CRITICAL — DATA MISSING";
}

// ─── Component ────────────────────────────────────────────────────────────────

interface MissionReadinessProps {
  input: ReadinessInput;
}

export default function MissionReadiness({ input }: MissionReadinessProps) {
  const domains = computeReadiness(input);
  const overall = Math.round(domains.reduce((s, d) => s + d.score, 0) / domains.length);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedDomain = domains.find((d) => d.id === selected);

  const overallColor = scoreColor(overall);
  const cx = 90, cy = 90, R = 72, trackW = 11;

  return (
    <div className="rounded-2xl border border-[var(--border)] card-glass overflow-hidden">

      <div className="flex flex-col lg:flex-row">

        {/* ── LEFT: gauge + domain bars ─────────────────────────────────── */}
        <div className="p-5 flex flex-col items-center gap-5 lg:w-64 shrink-0 border-b lg:border-b-0 lg:border-r border-[var(--border)]">

          {/* Main readiness gauge — single strong ring */}
          <div className="relative">
            <svg width="180" height="180" viewBox="0 0 180 180">
              {/* Track */}
              <circle
                cx={cx} cy={cy} r={R}
                fill="none" stroke="#1e2d4a" strokeWidth={trackW}
              />
              {/* Overall filled arc */}
              {overall > 0 && (
                <path
                  d={arcPath(overall, cx, cy, R)}
                  fill="none"
                  stroke={overallColor}
                  strokeWidth={trackW}
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 6px ${overallColor}60)` }}
                />
              )}
              {/* Score */}
              <text
                x={cx} y={cy - 12}
                textAnchor="middle"
                fill="white"
                fontSize={30}
                fontWeight={800}
                fontFamily="monospace"
              >
                {overall}%
              </text>
              {/* Label */}
              <text
                x={cx} y={cy + 8}
                textAnchor="middle"
                fill="#7a8fad"
                fontSize={7}
                fontFamily="monospace"
                letterSpacing="0.12em"
              >
                MISSION
              </text>
              <text
                x={cx} y={cy + 20}
                textAnchor="middle"
                fill="#7a8fad"
                fontSize={7}
                fontFamily="monospace"
                letterSpacing="0.12em"
              >
                READINESS
              </text>
              {/* Status badge arc-below */}
              <text
                x={cx} y={cy + 38}
                textAnchor="middle"
                fill={overallColor}
                fontSize={6.5}
                fontWeight={700}
                fontFamily="monospace"
                letterSpacing="0.1em"
              >
                {scoreLabel(overall)}
              </text>
            </svg>
          </div>

          {/* Domain score bars */}
          <div className="w-full space-y-2.5">
            {domains.map((d) => {
              const barColor = scoreColor(d.score);
              const isSelected = selected === d.id;
              return (
                <button
                  key={d.id}
                  onClick={() => setSelected(isSelected ? null : d.id)}
                  className="w-full text-left"
                >
                  <div className="flex justify-between items-center mb-1">
                    <span
                      className="text-[10px] font-mono uppercase tracking-wider transition-colors"
                      style={{ color: isSelected ? barColor : "var(--text-muted)" }}
                    >
                      {d.label}
                    </span>
                    <span
                      className="text-[10px] font-bold font-mono tabular-nums"
                      style={{ color: barColor }}
                    >
                      {d.score}%
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-[var(--bg-panel)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${d.score}%`,
                        background: barColor,
                        boxShadow: isSelected ? `0 0 5px ${barColor}70` : "none",
                        opacity: selected && !isSelected ? 0.25 : 1,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── RIGHT: domain detail panel ────────────────────────────────── */}
        <div className="flex-1 p-5 min-h-0">
          {selectedDomain ? (
            <div className="space-y-4">
              {/* Domain header */}
              <div className="flex items-center gap-3 pb-3 border-b border-[var(--border)]">
                <div
                  className="w-1 h-8 rounded-full shrink-0"
                  style={{ background: scoreColor(selectedDomain.score) }}
                />
                <div className="min-w-0">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-widest leading-none mb-1">
                    Domain
                  </div>
                  <div className="text-base font-bold font-mono text-[var(--text-primary)]">
                    {selectedDomain.label}
                  </div>
                </div>
                <div className="ml-auto text-right shrink-0">
                  <div
                    className="text-2xl font-extrabold font-mono leading-none"
                    style={{ color: scoreColor(selectedDomain.score) }}
                  >
                    {selectedDomain.score}%
                  </div>
                  <div
                    className="text-[8px] font-mono uppercase tracking-widest mt-0.5"
                    style={{ color: scoreColor(selectedDomain.score) }}
                  >
                    {scoreLabel(selectedDomain.score)}
                  </div>
                </div>
              </div>

              {/* Detail sections — compact */}
              <div className="space-y-3 text-xs">

                {selectedDomain.available.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--green)] shrink-0" />
                      <span className="text-[9px] font-mono text-[var(--green)] uppercase tracking-widest">
                        Available ({selectedDomain.available.length})
                      </span>
                    </div>
                    <ul className="space-y-0.5 pl-3 border-l border-[var(--green)]/25">
                      {selectedDomain.available.map((a, i) => (
                        <li key={i} className="font-mono text-[var(--text-muted)] leading-snug">{a}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedDomain.missing.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--border-bright)] shrink-0" />
                      <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-widest">
                        Missing ({selectedDomain.missing.length})
                      </span>
                    </div>
                    <ul className="space-y-0.5 pl-3 border-l border-[var(--border-bright)]/50">
                      {selectedDomain.missing.map((m, i) => (
                        <li key={i} className="font-mono text-[var(--text-muted)] leading-snug">{m}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedDomain.needsReview.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--amber)] shrink-0" />
                      <span className="text-[9px] font-mono text-[var(--amber)] uppercase tracking-widest">
                        Needs Review ({selectedDomain.needsReview.length})
                      </span>
                    </div>
                    <ul className="space-y-0.5 pl-3 border-l border-[var(--amber)]/30">
                      {selectedDomain.needsReview.map((r, i) => (
                        <li key={i} className="font-mono text-[var(--text-muted)] leading-snug">{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedDomain.risks.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--red)] shrink-0" />
                      <span className="text-[9px] font-mono text-[var(--red)] uppercase tracking-widest">
                        Risks
                      </span>
                    </div>
                    <ul className="space-y-0.5 pl-3 border-l border-[var(--red)]/30">
                      {selectedDomain.risks.map((r, i) => (
                        <li key={i} className="font-mono text-[var(--text-muted)] leading-snug">{r}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {selectedDomain.loweredBy.length > 0 && (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-panel)]/60 p-3">
                    <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-widest mb-1.5">
                      Reducing readiness
                    </div>
                    <ul className="space-y-0.5">
                      {selectedDomain.loweredBy.map((l, i) => (
                        <li key={i} className="font-mono text-[var(--text-muted)] leading-snug flex gap-2">
                          <span style={{ color: scoreColor(selectedDomain.score) }} className="shrink-0">·</span>
                          {l}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

              </div>
            </div>
          ) : (
            /* Empty state — clear instruction */
            <div className="h-full flex flex-col items-center justify-center text-center py-10">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" className="mb-3 opacity-30">
                <circle cx="16" cy="16" r="13" stroke="#7a8fad" strokeWidth="1.5" strokeDasharray="4 3" />
                <path d="M16 10v6M16 20v2" stroke="#7a8fad" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
              <div className="text-[10px] font-mono text-[var(--text-primary)] uppercase tracking-widest mb-2">
                Select a domain
              </div>
              <p className="text-xs text-[var(--text-muted)] max-w-[200px] leading-relaxed">
                Click any readiness bar to inspect available data, missing parameters,
                review items, and factors reducing readiness.
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
