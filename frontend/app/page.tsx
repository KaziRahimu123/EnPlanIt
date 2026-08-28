"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useRouter } from "next/navigation";
import { listMissions, type Mission } from "@/lib/api";
import SolarSystemHeroBackground from "@/components/SolarSystemHeroBackground";
import GlobalSpaceBackground from "@/components/GlobalSpaceBackground";
import pageStyles from "./page.module.css";

// ─── Mission Intelligence Graph ───────────────────────────────────────────────

const GRAPH_NODES = [
  { id: "mission",     label: "MISSION CORE",  x: 310, y: 130, color: "#3b82f6", glow: "#3b82f640" },
  { id: "power",       label: "POWER",         x: 100, y: 270, color: "#06b6d4", glow: "#06b6d430" },
  { id: "crew",        label: "CREW",          x: 520, y: 270, color: "#10b981", glow: "#10b98130" },
  { id: "resources",   label: "RESOURCES",     x: 80,  y: 430, color: "#f59e0b", glow: "#f59e0b30" },
  { id: "comms",       label: "COMMS",         x: 540, y: 430, color: "#8b5cf6", glow: "#8b5cf630" },
  { id: "constraints", label: "CONSTRAINTS",   x: 310, y: 530, color: "#ef4444", glow: "#ef444430" },
];

const GRAPH_EDGES = [
  { from: "mission",   to: "power",       label: "drives",    dur: 2.8 },
  { from: "mission",   to: "crew",        label: "drives",    dur: 3.2 },
  { from: "power",     to: "resources",   label: "limits",    dur: 2.4 },
  { from: "crew",      to: "comms",       label: "requires",  dur: 3.6 },
  { from: "power",     to: "comms",       label: "enables",   dur: 4.0 },
  { from: "resources", to: "constraints", label: "defines",   dur: 2.6 },
  { from: "comms",     to: "constraints", label: "constrains",dur: 3.0 },
  { from: "mission",   to: "constraints", label: "shapes",    dur: 5.0 },
];

const NODE_ICONS: Record<string, string> = {
  mission:     "M8 2l2 6h6l-5 4 2 6-5-4-5 4 2-6-5-4h6z",
  power:       "M13 2L5 13h6l-2 7 8-11H11z",
  crew:        "M8 8a3 3 0 100-6 3 3 0 000 6zM2 20v-1a6 6 0 0112 0v1",
  resources:   "M3 7h18M3 12h18M3 17h18",
  comms:       "M22 16.92v3a2 2 0 01-2.18 2A19.8 19.8 0 013.08 5.18 2 2 0 015 3h3a2 2 0 012 1.72c.127.96.361 1.9.7 2.81a2 2 0 01-.45 2.11L9.09 10.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.91.339 1.85.573 2.81.7A2 2 0 0122 17z",
  constraints: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
};

function getConnected(nodeId: string | null): Set<string> {
  if (!nodeId) return new Set();
  const s = new Set<string>([nodeId]);
  GRAPH_EDGES.forEach(({ from, to }) => {
    if (from === nodeId) s.add(to);
    if (to === nodeId) s.add(from);
  });
  return s;
}

function MissionGraph() {
  const [hovered, setHovered] = useState<string | null>(null);
  const connected = getConnected(hovered);

  const markerColors = [
    { id: "arr-blue",   color: "#3b82f6" },
    { id: "arr-cyan",   color: "#06b6d4" },
    { id: "arr-green",  color: "#10b981" },
    { id: "arr-amber",  color: "#f59e0b" },
    { id: "arr-purple", color: "#8b5cf6" },
    { id: "arr-red",    color: "#ef4444" },
    { id: "arr-dim",    color: "#1e2d4a" },
  ];

  return (
    <svg
      viewBox="0 0 620 620"
      className="w-full"
      style={{ overflow: "visible", maxHeight: 520 }}
    >
      <defs>
        {markerColors.map(({ id, color }) => (
          <marker
            key={id}
            id={id}
            markerWidth="8"
            markerHeight="8"
            refX="6"
            refY="3"
            orient="auto"
          >
            <path d="M0,0 L0,6 L8,3 z" fill={color} opacity="0.85" />
          </marker>
        ))}
        {GRAPH_NODES.map((n) => (
          <radialGradient key={`rg-${n.id}`} id={`rg-${n.id}`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={n.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={n.color} stopOpacity="0" />
          </radialGradient>
        ))}
      </defs>

      {hovered && (() => {
        const n = GRAPH_NODES.find((x) => x.id === hovered)!;
        return (
          <>
            <circle cx={n.x} cy={n.y} r={55} fill={`url(#rg-${n.id})`} opacity={0.6} />
            <circle cx={n.x} cy={n.y} r={75} fill={`url(#rg-${n.id})`} opacity={0.3} />
          </>
        );
      })()}

      {GRAPH_EDGES.map(({ from, to, dur }, i) => {
        const a = GRAPH_NODES.find((n) => n.id === from)!;
        const b = GRAPH_NODES.find((n) => n.id === to)!;
        const isActive = !hovered || (connected.has(from) && connected.has(to));
        const isDim = hovered && !isActive;
        const toNode = GRAPH_NODES.find((n) => n.id === to)!;
        const activeColor = toNode.color;
        const dx = b.x - a.x, dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const nx = dx / dist, ny = dy / dist;
        const x1 = a.x + nx * 52, y1 = a.y + ny * 22;
        const x2 = b.x - nx * 54, y2 = b.y - ny * 24;

        return (
          <g key={`edge-${i}`}>
            <line
              x1={x1} y1={y1} x2={x2} y2={y2}
              stroke={isActive ? activeColor : "#162035"}
              strokeWidth={isActive ? (hovered ? 2.2 : 1.4) : 0.8}
              strokeOpacity={isDim ? 0.12 : isActive ? 0.75 : 0.25}
              strokeDasharray={isActive ? "5 4" : undefined}
              style={{ transition: "stroke 0.3s, stroke-width 0.3s, stroke-opacity 0.3s" }}
            />
            {isActive && (
              <circle r={3} fill={activeColor} opacity={0.85}>
                <animateMotion
                  path={`M ${x1} ${y1} L ${x2} ${y2}`}
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                />
              </circle>
            )}
          </g>
        );
      })}

      {GRAPH_NODES.map((node) => {
        const isHovered = hovered === node.id;
        const isConn = connected.has(node.id);
        const isDim = hovered && !isConn;
        const isActive = !hovered || isConn;

        return (
          <g
            key={node.id}
            transform={`translate(${node.x}, ${node.y})`}
            onMouseEnter={() => setHovered(node.id)}
            onMouseLeave={() => setHovered(null)}
            style={{ cursor: "pointer" }}
          >
            <rect
              x={-56} y={-20} width={112} height={40} rx={8}
              fill={isHovered ? `${node.color}22` : isActive ? "rgba(6, 11, 24, 0.88)" : "rgba(4, 7, 16, 0.6)"}
              stroke={isHovered ? node.color : isActive ? `${node.color}88` : "#1e2d4a"}
              strokeWidth={isHovered ? 2 : 1}
              style={{ transition: "all 0.25s ease" }}
            />
            <path
              d={NODE_ICONS[node.id]}
              transform="translate(-46, -7) scale(0.7)"
              fill={isHovered ? node.color : isActive ? "#94a3b8" : "#334155"}
              style={{ transition: "fill 0.25s ease" }}
            />
            <text
              x={-24} y={1}
              dy="0.35em"
              fill={isHovered ? node.color : isActive ? "#94a3b8" : "#1e2d4a"}
              fontSize={isHovered ? 9.5 : 9}
              fontWeight={isHovered ? 700 : 500}
              letterSpacing="0.09em"
              fontFamily="monospace"
              style={{ transition: "all 0.25s ease" }}
            >
              {node.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { user, isLoading } = useUser();
  const router = useRouter();

  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);

  useEffect(() => {
    if (!user) return;
    setStatsLoading(true);
    listMissions()
      .then(setMissions)
      .catch(() => setMissions([]))
      .finally(() => setStatsLoading(false));
  }, [user]);

  function handleProtectedNav() {
    if (user) router.push("/dashboard");
    else window.location.href = "/auth/login?returnTo=/dashboard";
  }

  const activeMissions   = missions?.length ?? 0;
  const scenariosModeled = missions?.filter((m) => m.has_scenario).length ?? 0;
  const analysesRun      = missions?.filter((m) => m.mission_summary).length ?? 0;

  const STAT_CARDS = [
    { label: "Missions",  value: activeMissions,   color: "var(--accent)", waveColor: "#3b82f6" },
    { label: "Scenarios", value: scenariosModeled, color: "var(--green)",  waveColor: "#22c55e" },
    { label: "Analyses",  value: analysesRun,      color: "var(--amber)",  waveColor: "#f59e0b" },
  ];

  return (
    <div className={pageStyles.homeShell}>
      <GlobalSpaceBackground />
      <div className={pageStyles.pageContent}>

        {/* ══════════════════════════════════════════════════════════════════
            1. HERO SECTION
        ══════════════════════════════════════════════════════════════════ */}
        <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 sm:px-6 pt-16 pb-20 overflow-hidden">
          <SolarSystemHeroBackground />

          <div className="relative z-10 max-w-5xl mx-auto text-center space-y-6">
            {/* Top Pill Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-sky-400/40 bg-sky-950/70 backdrop-blur-md text-sky-200 text-xs sm:text-sm font-mono font-bold tracking-wider shadow-[0_0_20px_rgba(56,189,248,0.25)]">
              <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse shadow-[0_0_8px_#38bdf8]" />
              <span>⚡ INTERACTIVE MISSION DEPENDENCY MODEL FOR SPACE MISSIONS</span>
            </div>

            {/* Exactly 2 Clean Lines Heading */}
            <h1 className="text-2xl sm:text-4xl md:text-5xl lg:text-[3.6rem] font-black text-white tracking-tight leading-[1.15] drop-shadow-[0_4px_24px_rgba(0,0,0,0.9)]">
              <span className="block sm:whitespace-nowrap">Enlighten your mission.</span>
              <span className="block sm:whitespace-nowrap text-transparent bg-clip-text bg-gradient-to-r from-sky-300 via-blue-400 to-indigo-300 drop-shadow-[0_0_35px_rgba(56,189,248,0.4)]">
                Plan it to perfection.
              </span>
            </h1>

            {/* Clear, Engaging Subtitle */}
            <p className="text-slate-200 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]">
              Paste mission specs, upload flight dossiers, or drop a PDF — EnPlanIt builds interactive mission dependency models,
              topological subsystem graphs, risk trade-offs, and preliminary mission assessments in seconds.
            </p>

            {/* Dual CTA Buttons */}
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2">
              {!user ? (
                <>
                  <a
                    href="/auth/login?returnTo=/missions/create"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25 transition-all text-sm sm:text-base group cursor-pointer border-none no-underline"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-90">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Create Mission
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </a>
                  <a
                    href="/auth/login?returnTo=/dashboard"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-slate-200 border border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 transition-all text-sm sm:text-base cursor-pointer no-underline"
                  >
                    View Dashboard
                  </a>
                </>
              ) : (
                <>
                  <Link
                    href="/missions/create"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-bold text-white bg-blue-600 hover:bg-blue-500 shadow-lg shadow-blue-500/25 transition-all text-sm sm:text-base group"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="opacity-90">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                    Create Mission
                    <span className="group-hover:translate-x-1 transition-transform">→</span>
                  </Link>
                  <Link
                    href="/dashboard"
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-slate-200 border border-slate-700 bg-slate-900/60 hover:bg-slate-800/80 transition-all text-sm sm:text-base"
                  >
                    View Dashboard →
                  </Link>
                </>
              )}
            </div>

            {/* Target Audience Note */}
            <p className="text-[11px] font-mono text-slate-400 pt-1">
              Works for Cosmic Enthusiasts, Mission Architects, Systems Engineers, Space Agencies, and Research Labs.
            </p>

            {/* Logged-In Stats Telemetry Bar */}
            {user && (
              <div className="grid grid-cols-3 gap-3 max-w-lg mx-auto pt-6">
                {STAT_CARDS.map(({ label, value, color }) => (
                  <div key={label} className="p-3 rounded-xl border border-[#1e3a5f]/60 bg-[#040c1a]/90 backdrop-blur text-center">
                    <div className="text-2xl font-bold font-mono" style={{ color }}>{value}</div>
                    <div className="text-[10px] font-mono text-slate-400 uppercase tracking-wider mt-0.5">{label}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>


        {/* ══════════════════════════════════════════════════════════════════
            2. THREE KEY MISSION FEATURES (PILLARS OF ENPLANIT)
        ══════════════════════════════════════════════════════════════════ */}
        <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-400/30 bg-sky-950/60 text-sky-300 text-xs font-mono font-semibold uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
              <span>Core Architecture</span>
            </div>
            <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              3 key intelligence engines — from concept to orbit
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto">
              A unified aerospace pipeline: Ingest flight dossiers, analyze operational intelligence, and stress-test trade-offs in Scenario Lab.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1: Create Mission */}
            <div className="rounded-2xl border border-[#1e3a5f]/80 bg-[#040c1a]/90 p-7 space-y-4 hover:border-sky-500/50 transition-all shadow-xl relative overflow-hidden">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-2xl text-blue-400">
                🚀
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Create Mission
                </h3>
                <p className="text-xs text-sky-400/90 font-mono font-semibold mt-0.5">
                  Dossier Ingestion & Parameter Extraction
                </p>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Upload PDF, DOCX, TXT, or MD flight dossiers or describe mission concepts in natural language. EnPlanIt automatically parses up to 5,000 characters of architecture, extracts baseline parameters, and synthesizes the mission dependency model.
              </p>
              <ul className="space-y-2 pt-3 border-t border-[#1e3a5f]/40 text-xs text-slate-300 font-mono">
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 font-bold shrink-0">✓</span>
                  <span>Multi-document upload & cross-referencing</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 font-bold shrink-0">✓</span>
                  <span>Automated parameter facts extraction</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-400 font-bold shrink-0">✓</span>
                  <span>Active vs. historical specification separation</span>
                </li>
              </ul>
            </div>

            {/* 2: Analysis */}
            <div className="rounded-2xl border border-[#1e3a5f]/80 bg-[#040c1a]/90 p-7 space-y-4 hover:border-emerald-500/50 transition-all shadow-xl relative overflow-hidden">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-2xl text-emerald-400">
                🧠
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Mission Analysis
                </h3>
                <p className="text-xs text-emerald-400/90 font-mono font-semibold mt-0.5">
                  Intelligence Cockpit & Action Plans
                </p>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Deep mission intelligence cockpit featuring interactive topological orbital dependency models, 6 extracted or derived mission variables, and preliminary mission assessments with step-by-step operational directives.
              </p>
              <ul className="space-y-2 pt-3 border-t border-[#1e3a5f]/40 text-xs text-slate-300 font-mono">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">✓</span>
                  <span>Topological orbital dependency map</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">✓</span>
                  <span>6 extracted or derived mission variables</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-400 font-bold shrink-0">✓</span>
                  <span>Preliminary mission assessments & directives</span>
                </li>
              </ul>
            </div>

            {/* 3: Scenario Lab */}
            <div className="rounded-2xl border border-[#1e3a5f]/80 bg-[#040c1a]/90 p-7 space-y-4 hover:border-amber-500/50 transition-all shadow-xl relative overflow-hidden">
              <div className="w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-2xl text-amber-400">
                ⚡
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">
                  Scenario Lab
                </h3>
                <p className="text-xs text-amber-400/90 font-mono font-semibold mt-0.5">
                  Rule-Based Trade-Off Simulation
                </p>
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">
                Stress-test mission envelopes with rule-based mission calculations. Simulate solar blackouts, duration expansions, and communication delays with dependency and cascading-risk visualization and reference-based safety heuristics.
              </p>
              <ul className="space-y-2 pt-3 border-t border-[#1e3a5f]/40 text-xs text-slate-300 font-mono">
                <li className="flex items-start gap-2">
                  <span className="text-amber-400 font-bold shrink-0">✓</span>
                  <span>Rule-based Peukert battery & power autonomy</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-400 font-bold shrink-0">✓</span>
                  <span>Dependency and cascading-risk visualization across subsystems</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-400 font-bold shrink-0">✓</span>
                  <span>Engineering countermeasures & mitigations</span>
                </li>
              </ul>
            </div>
          </div>
        </section>


        {/* ══════════════════════════════════════════════════════════════════
            3. INTERACTIVE MISSION GRAPH SHOWCASE
        ══════════════════════════════════════════════════════════════════ */}
        <section className="py-16 px-4 sm:px-6 max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-300 text-[10px] font-mono uppercase tracking-wider">
                Interactive Systems Model
              </div>
              <h2 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                All mission systems are dynamically coupled
              </h2>
              <p className="text-slate-300 text-sm leading-relaxed">
                A change in power availability directly restricts life-support recycling, battery buffers, and operational flight envelopes. EnPlanIt maps these dependencies so you can trace the downstream impact of every decision.
              </p>
              <div className="grid grid-cols-2 gap-2.5 pt-2">
                {GRAPH_NODES.map((n) => (
                  <div key={n.id} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: n.color }} />
                    <span className="text-[11px] font-mono text-slate-300 uppercase tracking-wider">{n.label}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs font-mono text-slate-400 pt-1">
                ← Hover any node in the cockpit graph to trace active causal pathways
              </p>
              <div className="pt-2">
                <Link
                  href="/analysis"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-500 transition-all shadow-md"
                >
                  Explore Mission Analysis →
                </Link>
              </div>
            </div>

            <div className="rounded-2xl border border-[#1e3a5f] bg-[#040c1a]/90 p-6 shadow-2xl relative overflow-hidden">
              <div className="absolute inset-0 pointer-events-none bg-radial-gradient from-sky-500/10 to-transparent" />
              <MissionGraph />
            </div>
          </div>
        </section>


        {/* ══════════════════════════════════════════════════════════════════
            4. HOW IT WORKS (4-STEP PIPELINE)
        ══════════════════════════════════════════════════════════════════ */}
        <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              How it works
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
              From raw flight proposals to verified mission intelligence in 4 automated steps.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Step 1 */}
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
                1
              </div>
              <h3 className="text-base font-bold text-white">
                Upload flight dossier
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Paste a mission transcript, upload a PDF, or drop flight specifications and telemetry documents.
              </p>
            </div>

            {/* Step 2 */}
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
                2
              </div>
              <h3 className="text-base font-bold text-white">
                Dual-AI Pipeline Engine
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                IBM Watsonx Granite 3.0 + GPT-5.6 extract telemetry, verify constraints, and cross-reference safety standards.
              </p>
            </div>

            {/* Step 3 */}
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
                3
              </div>
              <h3 className="text-base font-bold text-white">
                Interactive mission dependency model
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Explore simulated topological graphs, stress-test variables, and model cascading subsystem impacts.
              </p>
            </div>

            {/* Step 4 */}
            <div className="text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-blue-600 text-white font-bold text-lg flex items-center justify-center mx-auto shadow-lg shadow-blue-500/30">
                4
              </div>
              <h3 className="text-base font-bold text-white">
                Deploy flight intelligence
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Export preliminary mission assessments, trade-off sensitivity reports, and engineering countermeasures.
              </p>
            </div>
          </div>
        </section>


        {/* ══════════════════════════════════════════════════════════════════
            5. BUILT FOR AEROSPACE TEAMS
        ══════════════════════════════════════════════════════════════════ */}
        <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto space-y-12">
          <div className="text-center space-y-3">
            <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              Built for aerospace mission teams
            </h2>
            <p className="text-slate-400 text-sm sm:text-base max-w-lg mx-auto">
              From concept architecture to preliminary mission analysis — EnPlanIt provides a unified cognitive cockpit.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {/* Role 1 */}
            <div className="rounded-2xl border border-[#1e3a5f]/60 bg-[#040c1a]/80 p-6 space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-xl mx-auto">
                🚀
              </div>
              <h3 className="text-sm font-bold text-white">Mission Architects</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Rapidly evaluate feasibility, payload mass budgets, resource margins, and lunar/Martian surface stay feasibility.
              </p>
            </div>

            {/* Role 2 */}
            <div className="rounded-2xl border border-[#1e3a5f]/60 bg-[#040c1a]/80 p-6 space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-xl mx-auto">
                🛰️
              </div>
              <h3 className="text-sm font-bold text-white">Systems Engineers</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Model electrical microgrids, solar degradation, thermal radiator wear, and battery depth-of-discharge.
              </p>
            </div>

            {/* Role 3 */}
            <div className="rounded-2xl border border-[#1e3a5f]/60 bg-[#040c1a]/80 p-6 space-y-3 text-center">
              <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-xl mx-auto">
                🔬
              </div>
              <h3 className="text-sm font-bold text-white">Payload & Science</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Assess in-situ resource utilization (ISRU), polar volatile cold traps, and continuous instrument power.
              </p>
            </div>
          </div>
        </section>


        {/* ══════════════════════════════════════════════════════════════════
            6. EVERYTHING YOU NEED (CHECKLIST FEATURE MATRIX)
        ══════════════════════════════════════════════════════════════════ */}
        <section className="py-20 px-4 sm:px-6 max-w-4xl mx-auto space-y-10">
          <div className="text-center space-y-2">
            <h2 className="text-2xl sm:text-4xl font-bold text-white tracking-tight">
              Everything you need
            </h2>
            <p className="text-slate-400 text-sm">
              The complete cognitive toolchain for modern space exploration.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-y-4 gap-x-8 text-xs font-mono text-slate-200">
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
              <span>Upload PDF, Word (DOCX), TXT, or Markdown (.md) dossiers</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
              <span>Reference-based safety heuristics</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
              <span>Simulated mission telemetry visualization with interactive dependency models</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
              <span>Rule-based mission calculations & trade-off engine</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
              <span>Multi-subsystem risk evaluation & cascading risk alerts</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-[10px] font-bold shrink-0">✓</span>
              <span>Role-specific workspace views & cloud mission persistence</span>
            </div>
          </div>
        </section>


        {/* ══════════════════════════════════════════════════════════════════
            7. MODERN FOOTER
        ══════════════════════════════════════════════════════════════════ */}
        <footer className="border-t border-[#1e3a5f]/60 py-8 px-4 sm:px-6 max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-slate-400">
          <div className="flex items-center gap-2.5 text-white font-bold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="EnPlanIt" className="w-5 h-5 object-contain" />
            <span>EnPlanIt</span>
            <span className="text-slate-500 font-normal">© 2026 · Enlighten your mission. Plan it to perfection.</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="hover:text-white transition-colors">Dashboard</Link>
            <Link href="/scenario-lab" className="hover:text-white transition-colors">Scenario Lab</Link>
            <Link href="/missions/create" className="hover:text-white transition-colors">New Mission</Link>
          </div>
        </footer>

      </div>{/* end pageContent */}
    </div>
  );
}
