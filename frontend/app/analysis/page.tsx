"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  analyzeMission,
  getMission,
  listDocuments,
  getMissionFacts,
  deleteDocument,
  type Mission,
  type MissionAnalysisResponse,
  type MissionExtracted,
  type MissionPlan,
  type MissionDocument,
  type DocumentFact,
} from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import FactsPanel from "@/components/FactsPanel";
import OrbitalMissionMap from "@/components/OrbitalMissionMap";
import PlanSectionsVisualizer from "@/components/PlanSectionsVisualizer";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function AiBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[10px] font-semibold text-[var(--accent-glow)] uppercase tracking-wider">
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
        <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" />
        <circle cx="5" cy="5" r="1.5" fill="currentColor" />
      </svg>
      AI Analysis
    </span>
  );
}


const PLAN_SECTIONS: Array<{ key: keyof MissionPlan; label: string; icon: string }> = [
  { key: "mission_summary",         label: "Mission Summary",          icon: "🚀" },
  { key: "objectives",              label: "Objectives",               icon: "🎯" },
  { key: "required_resources",      label: "Required Resources",       icon: "⚙️" },
  { key: "major_constraints",       label: "Major Constraints",        icon: "⚠️" },
  { key: "planning_considerations", label: "Planning Considerations",  icon: "📋" },
  { key: "missing_information",     label: "Missing Information",      icon: "❓" },
];

function AnalysisSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <div className="h-3 w-32 bg-[var(--border-bright)] rounded mb-4" />
        <div className="grid grid-cols-2 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-10 bg-[var(--bg-panel)] rounded-lg" />
          ))}
        </div>
      </div>
      {[...Array(3)].map((_, i) => (
        <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
          <div className="h-3 w-40 bg-[var(--border-bright)] rounded mb-3" />
          <div className="space-y-2">
            <div className="h-2 bg-[var(--bg-panel)] rounded w-full" />
            <div className="h-2 bg-[var(--bg-panel)] rounded w-5/6" />
            <div className="h-2 bg-[var(--bg-panel)] rounded w-4/6" />
          </div>
        </div>
      ))}
    </div>
  );
}

function PlanCard({ plan }: { plan: MissionPlan }) {
  return (
    <div className="space-y-4">
      {PLAN_SECTIONS.map(({ key, label, icon }) => {
        const text = plan[key] ?? "";
        const isMissing = key === "missing_information";
        return (
          <div
            key={key}
            className={`rounded-xl border bg-[var(--bg-card)] overflow-hidden ${
              isMissing
                ? "border-[var(--amber)]/30"
                : "border-[var(--border)]"
            }`}
          >
            <div
              className={`px-5 py-3.5 border-b flex items-center gap-2 ${
                isMissing
                  ? "border-[var(--amber)]/20 bg-[var(--amber)]/5"
                  : "border-[var(--border)]"
              }`}
            >
              <span className="text-base">{icon}</span>
              <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
                {label}
              </h3>
              <div className="ml-auto">
                <AiBadge />
              </div>
            </div>
            <div className="px-5 py-4">
              {text ? (
                <div className="text-sm text-[var(--text-primary)] leading-relaxed whitespace-pre-line">
                  {text}
                </div>
              ) : (
                <span className="text-sm italic text-[var(--text-muted)]">Not provided</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Read-only document list with delete support (no upload here)
// ---------------------------------------------------------------------------

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

interface DocumentListProps {
  missionId: string;
  documents: MissionDocument[];
  onDocumentsChange: (docs: MissionDocument[]) => void;
  isAerospace?: boolean;
}

function DocumentList({ missionId, documents, onDocumentsChange, isAerospace = true }: DocumentListProps) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function handleDelete(docId: string) {
    if (confirmDeleteId !== docId) { setConfirmDeleteId(docId); return; }
    setDeletingId(docId);
    setConfirmDeleteId(null);
    setDeleteError(null);
    try {
      await deleteDocument(missionId, docId);
      onDocumentsChange(documents.filter((d: MissionDocument) => d.id !== docId));
    } catch {
      setDeleteError("Failed to delete document.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[var(--border)] flex items-center gap-2">
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
          <rect x="2" y="1" width="8" height="11" rx="1" stroke="var(--text-muted)" strokeWidth="1.2" />
          <path d="M4 4h5M4 6.5h5M4 9h3" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" />
          <path d="M8 1v3h3" stroke="var(--text-muted)" strokeWidth="1" strokeLinecap="round" />
        </svg>
        <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
          Mission Documents
        </h2>
        <span className="text-[10px] text-[var(--text-muted)]">
          {documents.length} file{documents.length !== 1 ? "s" : ""}
        </span>
        {!isAerospace && (
          <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold uppercase tracking-wider">
            ⚠️ Unrelated Topic Detected
          </span>
        )}
        <Link
          href={`/missions/create`}
          className="ml-auto text-[10px] text-[var(--accent-glow)] hover:underline"
        >
          + Upload more on Create Mission
        </Link>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {documents.map((doc: MissionDocument) => {
          const ext = (doc.file_type ?? "").toUpperCase();
          const isDocUnrelated = !isAerospace && doc.status === "ready";
          const statusCfg: Record<string, string> = {
            uploaded:   "border-[var(--border)] text-[var(--text-muted)]",
            processing: "border-[var(--accent)]/40 text-[var(--accent-glow)] animate-pulse",
            ready:      isDocUnrelated ? "border-amber-500/40 bg-amber-500/10 text-amber-300" : "border-[var(--green)]/40 text-[var(--green)]",
            error:      "border-[var(--red)]/40 text-red-400",
          };
          const statusLabel: Record<string, string> = {
            uploaded: "Uploaded",
            processing: "Processing",
            ready: isDocUnrelated ? "⚠️ Unrelated Topic" : "Ready",
            error: "Error",
          };
          const pillCls = statusCfg[doc.status] ?? "border-[var(--border)] text-[var(--text-muted)]";
          return (
            <div key={doc.id} className="px-5 py-3.5 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--bg-panel)] flex items-center justify-center shrink-0 text-[10px] font-bold text-[var(--text-muted)] uppercase mt-0.5">
                {ext}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-0.5">
                  <span className="text-sm font-medium text-[var(--text-primary)] truncate max-w-[200px]">
                    {doc.filename}
                  </span>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider ${pillCls}`}>
                    {statusLabel[doc.status] ?? doc.status}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
                  {doc.file_size > 0 && (
                    <span>
                      {doc.file_size < 1024 * 1024
                        ? `${(doc.file_size / 1024).toFixed(1)} KB`
                        : `${(doc.file_size / (1024 * 1024)).toFixed(1)} MB`}
                    </span>
                  )}
                  {doc.page_count ? <span>{doc.page_count} pages</span> : null}
                  {doc.word_count ? <span>{doc.word_count.toLocaleString()} words</span> : null}
                  {isDocUnrelated && (
                    <span className="text-amber-400 font-mono">⚠️ Non-aerospace topic (0 flight telemetry channels verified)</span>
                  )}
                  {doc.status === "error" && doc.error_message && (
                    <span className="text-red-400">⚠ {doc.error_message.slice(0, 60)}</span>
                  )}
                </div>
              </div>
              <div className="shrink-0">
                {confirmDeleteId === doc.id ? (
                  <div className="flex items-center gap-2">
                    <button onClick={() => handleDelete(doc.id)} disabled={deletingId === doc.id} className="text-xs text-red-400 hover:underline font-semibold">
                      Confirm
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} className="text-xs text-[var(--text-muted)] hover:underline">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => handleDelete(doc.id)} disabled={deletingId === doc.id} className="text-xs text-[var(--text-muted)] hover:text-red-400 transition-colors">
                    {deletingId === doc.id ? "…" : "Remove"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {deleteError && (
        <div className="mx-4 mb-3 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-red-300">
          ⚠ {deleteError}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page content
// ---------------------------------------------------------------------------

function AnalysisContent() {
  const params = useSearchParams();
  const missionId = params.get("missionId");

  const [mission, setMission] = useState<Mission | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [result, setResult] = useState<MissionAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fetchingMission, setFetchingMission] = useState(false);
  const [savedBanner, setSavedBanner] = useState(false);
  const [saveWarning, setSaveWarning] = useState<string | null>(null);
  const [documents, setDocuments] = useState<MissionDocument[]>([]);
  const [facts, setFacts] = useState<DocumentFact[]>([]);
  const [descExpanded, setDescExpanded] = useState(false);
  const [showDescModal, setShowDescModal] = useState(false);
  const [factsLoading, setFactsLoading] = useState(false);

  // Fetch mission — also pre-populate result from saved data if analysis was done
  useEffect(() => {
    if (!missionId) return;
    setFetchingMission(true);
    getMission(missionId)
      .then((m) => {
        setMission(m);
        setDescription(m.description);
        // If this mission already has AI analysis, show it immediately
        if (m.mission_summary) {
          setResult({
            mission_id: missionId,
            extracted: {
              destination: m.destination ?? "",
              mission_type: m.mission_type ?? "",
              objective: m.objective ?? "",
              duration: m.duration ?? "",
              power_source: m.power_source ?? "",
              known_resources: m.known_resources ?? "",
            },
            plan: {
              mission_summary: m.mission_summary ?? "",
              objectives: m.objectives ?? "",
              required_resources: m.required_resources ?? "",
              major_constraints: m.major_constraints ?? "",
              planning_considerations: m.planning_considerations ?? "",
              missing_information: m.missing_information ?? "",
            },
            ai_available: true,
            error: null,
          });
        }
      })
      .catch(() => {
        setMission(null);
        setDescription(null);
      })
      .finally(() => setFetchingMission(false));

    // Load documents and facts in parallel
    listDocuments(missionId)
      .then(setDocuments)
      .catch(() => setDocuments([]));

    setFactsLoading(true);
    getMissionFacts(missionId)
      .then((r) => setFacts(r.facts))
      .catch(() => setFacts([]))
      .finally(() => setFactsLoading(false));
  }, [missionId]);

  // Refresh facts after documents change (new upload or delete)
  async function refreshFacts() {
    if (!missionId) return;
    setFactsLoading(true);
    try {
      const r = await getMissionFacts(missionId);
      setFacts(r.facts);
    } catch {
      // silently ignore
    } finally {
      setFactsLoading(false);
    }
  }

  async function handleAnalyze() {
    if (!missionId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setSavedBanner(false);
    setSaveWarning(null);
    try {
      // save=true when a missionId is present — persists results to DB
      const res = await analyzeMission(missionId, description || "", true);
      setResult(res);
      if (res.saved === true) {
        setSavedBanner(true);
        setSaveWarning(null);
      } else if (res.saved === false) {
        setSavedBanner(false);
        setSaveWarning(res.save_error || "Analysis generated, but failed to save to database. Please retry.");
      }
      await refreshFacts();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 sm:px-8 py-6 space-y-5">
      {/* ── Top Header Bar ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-[#1e3a5f]/40">
        <div>
          <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-mono">
            <span className="w-3 h-px bg-sky-400" />
            <span>EnPlanIt Mission Intelligence</span>
          </div>
          <h1 className="text-2xl font-bold text-white font-mono mt-0.5">Mission Analysis Cockpit</h1>
        </div>

        {mission && (
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
            <div className="px-2.5 py-1 rounded-lg border border-[#1e3a5f]/60 bg-[#030914] flex items-center gap-1.5">
              <span className="text-[9px] text-[var(--text-muted)] uppercase">Target:</span>
              <span className="font-bold text-sky-300">{mission.destination || "Deep Space Target"}</span>
            </div>
            <div className="px-2.5 py-1 rounded-lg border border-[#1e3a5f]/60 bg-[#030914] flex items-center gap-1.5">
              <span className="text-[9px] text-[var(--text-muted)] uppercase">Duration:</span>
              <span className="font-bold text-emerald-300">{mission.duration || "Planned"}</span>
            </div>
            <div className="px-2.5 py-1 rounded-lg border border-[#1e3a5f]/60 bg-[#030914] flex items-center gap-1.5">
              <span className="text-[9px] text-[var(--text-muted)] uppercase">Power:</span>
              <span className="font-bold text-amber-300">{mission.power_source || "Solar / Battery"}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── No mission state ── */}
      {!missionId && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center mb-6">
          <p className="text-sm text-[var(--text-muted)] mb-4">
            No mission selected. Create a mission first to run analysis.
          </p>
          <Link
            href="/missions/create"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, var(--accent-dim), var(--accent))" }}
          >
            Create Mission →
          </Link>
        </div>
      )}

      {/* ── Mission description preview + Analyze button ── */}
      {missionId && (
        <div className="rounded-xl border border-[#1e3a5f] bg-[#050f20] p-3.5 sm:p-4 shadow-xl relative overflow-hidden">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className="text-sm">📋</span>
              <h2 className="text-xs font-bold text-white uppercase tracking-widest font-mono">
                Mission Description
              </h2>
              {description && !isAerospaceText(description) && (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-amber-500/40 bg-amber-500/10 text-amber-300 font-bold uppercase tracking-wider">
                  ⚠️ Non-Aerospace Content
                </span>
              )}
              {description && (
                <span className="text-[9px] font-mono px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300 font-semibold uppercase tracking-wider hidden md:inline-block">
                  Showing up to 5,000 chars ({Math.min(description.length, 5000).toLocaleString()}/5,000)
                </span>
              )}
              {description && description.length > 140 && (
                <button
                  onClick={() => setDescExpanded(!descExpanded)}
                  className="text-[9px] font-mono px-2 py-0.5 rounded border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 transition-all font-semibold uppercase tracking-wider hidden sm:inline-block"
                >
                  {descExpanded ? "Collapse ▲" : "Expand Description ▼"}
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              {description && (
                <button
                  onClick={() => setShowDescModal(true)}
                  className="px-2.5 py-1 rounded-lg border border-[#1e3a5f] bg-[#030914] text-[10px] font-mono font-semibold text-slate-300 hover:text-white hover:border-sky-500/60 transition-all flex items-center gap-1.5"
                  title="Inspect Full Mission Dossier (up to 5,000 characters)"
                >
                  <span>🔍</span>
                  <span className="hidden sm:inline">Inspect Dossier</span>
                </button>
              )}

              {description && !loading && (
                <button
                  onClick={handleAnalyze}
                  className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white transition-all font-mono shadow-md"
                  style={{
                    background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
                    boxShadow: "0 0 14px rgba(59,130,246,0.3)",
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" />
                    <circle cx="7" cy="7" r="2" fill="currentColor" />
                  </svg>
                  Run Analysis
                </button>
              )}
            </div>
          </div>

          {fetchingMission ? (
            <div className="h-14 bg-[#030914] rounded animate-pulse" />
          ) : description ? (
            <div className="space-y-2">
              <div
                onClick={() => setDescExpanded(!descExpanded)}
                className="cursor-pointer group/desc relative rounded-lg border border-[#1e3a5f]/40 bg-[#020712] p-2.5 hover:border-sky-500/40 transition-colors"
              >
                <p className={`text-xs font-mono text-slate-300 leading-relaxed ${descExpanded ? "" : "line-clamp-2"}`}>
                  {description.slice(0, 5000)}
                </p>
                {!descExpanded && description.length > 140 && (
                  <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-sky-400 font-semibold pt-1 border-t border-[#1e3a5f]/30">
                    <span className="group-hover/desc:underline">Click to expand full text (up to 5,000 chars)</span>
                    <span>▼</span>
                  </div>
                )}
                {descExpanded && (
                  <div className="mt-1.5 flex items-center justify-between text-[9px] font-mono text-sky-400 font-semibold pt-1 border-t border-[#1e3a5f]/30">
                    <span className="group-hover/desc:underline">Click to collapse</span>
                    <span>▲</span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-xs font-mono italic text-[var(--text-muted)]">
              Could not load mission description. Is the backend running?
            </p>
          )}
        </div>
      )}

      {/* ── Full Mission Dossier Modal ── */}
      {showDescModal && description && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-3xl rounded-xl border border-sky-500/50 bg-[#030a18] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-[#1e3a5f] bg-[#020612] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-lg">📄</span>
                <div>
                  <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                    {mission?.name || "Mission Dossier"}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-sky-400">
                      Destination: {mission?.destination || "Deep Space Target"}
                    </span>
                    {documents.length > 0 && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 uppercase">
                        {documents.length} Document{documents.length > 1 ? "s" : ""} Synced
                      </span>
                    )}
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border border-sky-500/40 bg-sky-500/10 text-sky-300 uppercase">
                      Showing up to 5,000 characters
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setShowDescModal(false)}
                className="w-7 h-7 rounded border border-[#1e3a5f] bg-[#030914] text-slate-400 hover:text-white hover:border-slate-400 transition-colors flex items-center justify-center text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Document relationship banner */}
              {documents.length > 1 && (
                <div className="p-3 rounded-lg border border-sky-500/30 bg-sky-950/20 text-xs font-mono text-sky-200 flex items-start gap-2.5">
                  <span className="text-sky-400 mt-0.5">ℹ</span>
                  <div>
                    <span className="font-bold text-white uppercase">Multi-Document Relationship Synthesis:</span>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Cross-referenced across {documents.length} uploaded files ({documents.map(d => d.filename).join(", ")}).
                      Telemetry parameters and flight envelopes are dynamically prioritized from the active operational specification.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    Operational Flight Specification & Architecture:
                  </span>
                  <span className="text-[9px] font-mono text-sky-400 font-semibold">
                    Showing {Math.min(description.length, 5000).toLocaleString()} / 5,000 characters
                  </span>
                </div>
                <div className="p-4 rounded-lg border border-[#1e3a5f] bg-[#01040a] text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap selection:bg-sky-500/30 max-h-[45vh] overflow-y-auto font-sans">
                  {description.slice(0, 5000).split('\n').map((line, idx) => {
                    const trimmed = line.trim();
                    if (!trimmed) return <br key={idx} />;
                    if (trimmed.startsWith('=') || trimmed.startsWith('-') || (trimmed.endsWith(':') && trimmed.length < 50)) {
                      return <div key={idx} className="font-mono text-sky-300 font-bold mt-2 mb-1">{trimmed}</div>;
                    }
                    return <p key={idx} className="mb-2 leading-relaxed text-slate-200">{trimmed}</p>;
                  })}
                </div>
              </div>

              {/* Quick Specs bar */}
              <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#1e3a5f]/50">
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Duration</div>
                  <div className="text-xs font-mono font-bold text-emerald-300 mt-0.5 truncate">
                    {mission?.duration || "Planned"}
                  </div>
                </div>
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Power Source</div>
                  <div className="text-xs font-mono font-bold text-amber-300 mt-0.5 truncate">
                    {mission?.power_source || "Solar / Battery"}
                  </div>
                </div>
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Resources</div>
                  <div className="text-xs font-mono font-bold text-sky-300 mt-0.5 truncate">
                    {mission?.known_resources || "Closed-Loop"}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#1e3a5f] bg-[#020612] flex items-center justify-end gap-2">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(description);
                }}
                className="px-3 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#030914] text-xs font-mono text-slate-300 hover:text-white transition-colors"
              >
                Copy Text 📋
              </button>
              <button
                onClick={() => setShowDescModal(false)}
                className="px-4 py-1.5 rounded-lg text-xs font-mono font-semibold text-white"
                style={{ background: "linear-gradient(135deg, var(--accent-dim), var(--accent))" }}
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Extracted Telemetry Channels (Compact Full-Width 6-Column Strip) ── */}
      {missionId && (documents.length > 0 || facts.length > 0 || factsLoading || description) && (
        <div className="space-y-3">
          {(facts.length > 0 || factsLoading || description) && (
            <FactsPanel
              facts={facts}
              loading={factsLoading}
              missionDescription={description}
              duration={mission?.duration || result?.extracted?.duration}
              powerSource={mission?.power_source || result?.extracted?.power_source}
              knownResources={mission?.known_resources || result?.extracted?.known_resources}
            />
          )}
          {documents.length > 0 && (
            <DocumentList
              documents={documents}
              missionId={missionId}
              isAerospace={isAerospaceText(description)}
              onDocumentsChange={(updated) => {
                setDocuments(updated);
                refreshFacts();
              }}
            />
          )}
        </div>
      )}

      {/* ── Saved banner ── */}
      {savedBanner && (
        <div className="rounded-xl border border-[var(--green)]/30 bg-[var(--green)]/5 px-4 py-2.5 flex items-center gap-2 text-xs font-mono text-[var(--green)]">
          <span>✓</span>
          <span>Analysis results confirmed and saved to your mission database.</span>
        </div>
      )}

      {/* ── Save Warning / Retry banner ── */}
      {saveWarning && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 flex items-center justify-between gap-3 text-xs font-mono text-amber-300">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{saveWarning}</span>
          </div>
          <button
            onClick={handleAnalyze}
            className="px-3 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 font-bold text-[11px] uppercase tracking-wider transition-colors shrink-0"
          >
            Retry Save ↻
          </button>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 px-5 py-4 mb-4">
            <svg className="animate-spin h-4 w-4 text-[var(--accent-glow)] shrink-0" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">
                AI is analyzing your mission…
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Extracting parameters, then generating preliminary plan. This may take 10–30 seconds.
              </p>
            </div>
          </div>
          <AnalysisSkeleton />
        </div>
      )}

      {/* ── Request error ── */}
      {error && (
        <div className="rounded-xl border border-[var(--red)]/40 bg-[var(--red)]/10 px-5 py-4 text-sm text-red-300">
          <p className="font-medium mb-1">⚠ Analysis request failed</p>
          <p className="text-xs text-red-400/80">{error}</p>
          <p className="text-xs text-red-400/60 mt-1">Is the backend running on port 8000?</p>
        </div>
      )}

      {/* ── AI unavailable banner ── */}
      {result && !result.ai_available && (
        <div className="rounded-xl border border-[var(--amber)]/40 bg-[var(--amber)]/5 px-5 py-4">
          <p className="text-sm font-medium text-[var(--amber)] mb-1">
            AI Module Unavailable
          </p>
          <p className="text-xs text-[var(--text-muted)] leading-relaxed">
            {result.error?.includes("not configured")
              ? "OPENAI_API_KEY is not configured. Add it to backend/.env to enable AI analysis."
              : `AI call failed: ${result.error}`}
          </p>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            See <code className="font-mono text-[var(--text-primary)]">backend/.env.example</code> for setup instructions.
          </p>
        </div>
      )}

      {/* ── Results Suite ── */}
      {result?.ai_available && result.extracted && result.plan && (
        <div className="space-y-5">
          {/* 1. Orbital Mission Intelligence Map (Full-Width Interactive Digital Twin) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="w-3 h-px bg-sky-400" />
              <h2 className="text-xs font-bold text-white uppercase tracking-widest font-mono">
                Orbital Mission Intelligence Map
              </h2>
              <span className="text-[10px] font-mono text-[var(--text-muted)]">— interactive systems model</span>
            </div>
            <OrbitalMissionMap
              missionId={missionId}
              extracted={result.extracted as MissionExtracted}
              plan={result.plan as MissionPlan}
              facts={facts}
            />
          </div>

          {/* 2. Flight Operations Plan Hub (Tabbed Intelligence Suite) */}
          <PlanSectionsVisualizer
            plan={result.plan as MissionPlan}
            missionDestination={result.extracted?.destination ?? mission?.destination}
            missionDuration={result.extracted?.duration ?? mission?.duration}
            missionPower={result.extracted?.power_source ?? mission?.power_source}
            missionId={missionId}
          />

          {/* Scenario Lab link */}
          <div className="flex items-center justify-between rounded-xl border border-[#1e3a5f]/60 bg-[#040c1a] px-5 py-3.5 shadow-md">
            <div>
              <p className="text-xs font-mono font-bold text-white">
                Ready to model multi-subsystem scenario changes?
              </p>
              <p className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5">
                Simulate variances in solar output, mission span, battery capacity, and comm delays.
              </p>
            </div>
            <Link
              href={`/scenario-lab?missionId=${missionId}`}
              className="px-4 py-2 rounded-lg text-xs font-mono font-bold text-white bg-sky-600 hover:bg-sky-500 transition-all shadow-md"
            >
              Open Scenario Lab →
            </Link>
          </div>
        </div>
      )}

      {/* ── Idle state (no run yet, mission loaded) ── */}
      {!loading && !result && !error && missionId && description && (
        <div className="rounded-xl border border-dashed border-[var(--border-bright)] bg-[var(--bg-card)] p-10 text-center">
          <div className="text-3xl mb-3">🛰</div>
          <p className="text-sm font-medium text-[var(--text-primary)] mb-1">
            Ready to analyze
          </p>
          <p className="text-xs text-[var(--text-muted)] max-w-sm mx-auto mb-5">
            Click <strong className="text-[var(--text-primary)]">Run Analysis</strong> above to extract
            mission parameters and generate a preliminary planning overview.
          </p>
          <button
            onClick={handleAnalyze}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white"
            style={{ background: "linear-gradient(135deg, var(--accent-dim), var(--accent))" }}
          >
            Run Analysis
          </button>
        </div>
      )}
    </div>
  );
}

function AnalysisPage() {
  return (
    <Suspense>
      <AnalysisContent />
    </Suspense>
  );
}

export default function AnalysisPageWrapper() {
  return (
    <RequireAuth>
      <AnalysisPage />
    </RequireAuth>
  );
}
