"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUser } from "@auth0/nextjs-auth0/client";
import { listMissions, deleteMission, type Mission } from "@/lib/api";
import RequireAuth from "@/components/RequireAuth";
import { useRole, ROLE_META } from "@/lib/RoleContext";

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function DashboardContent() {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedMissionForDossier, setSelectedMissionForDossier] = useState<Mission | null>(null);
  const { user } = useUser();
  const { role } = useRole();
  const displayName = user?.name ?? user?.email ?? "";
  const roleMeta = role ? ROLE_META[role] : null;

  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchMissions = () => {
    setLoading(true);
    setLoadError(null);
    listMissions()
      .then((data) => {
        setMissions(data || []);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : "Failed to load missions.");
        setMissions([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchMissions();
  }, []);

  async function handleDelete(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    setConfirmDeleteId(null);
    try {
      await deleteMission(id);
      setMissions((prev) => prev.filter((m) => m.id !== id));
    } catch {
      // ignore
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mb-3 uppercase tracking-widest">
            <span className="w-4 h-px bg-[var(--accent)]" />
            Operations Overview
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-[var(--text-muted)] text-sm">
              {user ? `Welcome back, ${displayName}.` : "All missions, scenarios, and system health at a glance."}
            </p>
            {roleMeta && (
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wider"
                style={{
                  borderColor: `color-mix(in srgb, ${roleMeta.color} 40%, transparent)`,
                  color: roleMeta.color,
                  background: `color-mix(in srgb, ${roleMeta.color} 10%, transparent)`,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: roleMeta.color }} />
                {roleMeta.label}
              </span>
            )}
          </div>
        </div>
        <Link
          href="/missions/create"
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
          style={{
            background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
            boxShadow: "0 0 12px rgba(59,130,246,0.25)",
          }}
        >
          + New Mission
        </Link>
      </div>

      {/* Mission summary stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          {
            label: "Missions",
            value: loading ? "—" : String(missions.length),
          },
          {
            label: "With Scenario",
            value: loading ? "—" : String(missions.filter((m) => m.has_scenario).length),
          },
          {
            label: "Analyzed",
            value: loading ? "—" : String(missions.filter((m) => m.mission_summary).length),
          },
        ].map(({ label, value }) => (
          <div
            key={label}
            className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] card-glass p-4"
          >
            <div className="text-xs text-[var(--text-muted)] uppercase tracking-wider mb-1">
              {label}
            </div>
            <div className="text-xl font-bold text-[var(--text-primary)]">{value}</div>
          </div>
        ))}
      </div>

      {/* Missions table */}
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] card-glass overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--border)]">
          <h2 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-widest">
            My Missions
          </h2>
          <span className="text-[10px] text-[var(--text-muted)]">{missions.length} total</span>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--text-muted)]">
            Loading missions…
          </div>
        ) : loadError ? (
          <div className="px-5 py-8 text-center space-y-3">
            <div className="text-red-400 text-sm font-mono font-semibold">⚠️ {loadError}</div>
            <button
              onClick={fetchMissions}
              className="px-4 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 text-xs font-mono hover:bg-sky-500/20 transition-colors"
            >
              🔄 Retry
            </button>
          </div>
        ) : missions.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-3xl mb-3">🛰</div>
            <p className="text-sm font-medium text-[var(--text-primary)] mb-1">No missions yet.</p>
            <p className="text-xs text-[var(--text-muted)] mb-5">
              Create your first mission to get started.
            </p>
            <Link
              href="/missions/create"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold text-white transition-all"
              style={{ background: "linear-gradient(135deg, var(--accent-dim), var(--accent))" }}
            >
              + New Mission
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)]">
                {["Mission", "Info", "Updated", "Actions"].map((h) => (
                  <th
                    key={h}
                    className="px-5 py-2.5 text-left text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {missions.map((m) => (
                <tr
                  key={m.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--bg-panel)] transition-colors group"
                >
                  <td
                    className="px-5 py-3 cursor-pointer"
                    onClick={() => setSelectedMissionForDossier(m)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-[var(--text-primary)] group-hover:text-sky-300 transition-colors">
                        {m.name}
                      </span>
                    </div>
                    <div className="text-[10px] font-mono text-[var(--text-muted)] mt-0.5 line-clamp-1 max-w-xs group-hover:text-slate-300">
                      {m.description || "No description provided"}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    {m.destination && m.destination !== "Unknown" ? (
                      <div className="text-xs text-[var(--text-primary)] font-mono">🪐 {m.destination}</div>
                    ) : null}
                    {m.mission_type && m.mission_type !== "Unknown" ? (
                      <div className="text-[10px] text-[var(--text-muted)]">{m.mission_type}</div>
                    ) : (
                      <span className="text-[10px] italic text-[var(--text-muted)]">Not analyzed</span>
                    )}
                    {m.has_scenario && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--accent)]/10 text-[var(--accent-glow)] border border-[var(--accent)]/20 mt-0.5 inline-block font-mono">
                        Scenario saved
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[var(--text-muted)] text-xs font-mono">
                    {timeAgo(m.updated_at)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2 flex-wrap font-mono text-xs">
                      <button
                        onClick={() => setSelectedMissionForDossier(m)}
                        className="text-slate-300 hover:text-sky-300 hover:underline"
                        title="View Full Description & Specs"
                      >
                        Dossier
                      </button>
                      <span className="text-[var(--border-bright)]">·</span>
                      <Link
                        href={`/analysis?missionId=${m.id}`}
                        className="text-[var(--accent-glow)] hover:underline"
                      >
                        Analyze
                      </Link>
                      <span className="text-[var(--border-bright)]">·</span>
                      <Link
                        href={`/scenario-lab?missionId=${m.id}`}
                        className="text-[var(--accent-glow)] hover:underline"
                      >
                        Scenario
                      </Link>
                      <span className="text-[var(--border-bright)]">·</span>
                      {confirmDeleteId === m.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(m.id)}
                            disabled={deletingId === m.id}
                            className="text-red-400 hover:underline font-semibold"
                          >
                            Confirm delete
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="text-[var(--text-muted)] hover:underline"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => handleDelete(m.id)}
                          disabled={deletingId === m.id}
                          className="text-[var(--text-muted)] hover:text-red-400 hover:underline transition-colors"
                        >
                          {deletingId === m.id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Mission Dossier Inspection Modal ── */}
      {selectedMissionForDossier && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-2xl rounded-xl border border-sky-500/50 bg-[#030a18] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-[#1e3a5f] bg-[#020612] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">🚀</span>
                <div>
                  <h3 className="text-sm font-mono font-bold text-white uppercase tracking-wider">
                    {selectedMissionForDossier.name}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-[10px] font-mono text-sky-400">
                      Destination: {selectedMissionForDossier.destination || "Target Orbit / Surface"}
                    </span>
                    <span className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold border border-sky-500/40 bg-sky-500/10 text-sky-300 uppercase">
                      Showing up to 5,000 characters
                    </span>
                  </div>
                </div>
              </div>
              <button
                onClick={() => setSelectedMissionForDossier(null)}
                className="w-7 h-7 rounded border border-[#1e3a5f] bg-[#030914] text-slate-400 hover:text-white hover:border-slate-400 transition-colors flex items-center justify-center text-xs font-mono"
              >
                ✕
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-mono font-bold text-[var(--text-muted)] uppercase tracking-wider">
                    Full Mission Description & Flight Profile:
                  </span>
                  <span className="text-[9px] font-mono text-sky-400 font-semibold">
                    Showing {Math.min((selectedMissionForDossier.description || "").length, 5000).toLocaleString()} / 5,000 characters
                  </span>
                </div>
                <div className="p-4 rounded-lg border border-[#1e3a5f] bg-[#01040a] text-xs font-mono text-slate-200 leading-relaxed whitespace-pre-wrap selection:bg-sky-500/30">
                  {(selectedMissionForDossier.description || "No mission description provided.").slice(0, 5000)}
                </div>
              </div>

              {/* Quick Specs bar */}
              <div className="grid grid-cols-3 gap-2.5 pt-2 border-t border-[#1e3a5f]/50">
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Duration</div>
                  <div className="text-xs font-mono font-bold text-emerald-300 mt-0.5 truncate">
                    {selectedMissionForDossier.duration || "Not specified"}
                  </div>
                </div>
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Power Source</div>
                  <div className="text-xs font-mono font-bold text-amber-300 mt-0.5 truncate">
                    {selectedMissionForDossier.power_source || "Solar / Battery"}
                  </div>
                </div>
                <div className="rounded border border-[#1e3a5f]/40 bg-[#020712] p-2">
                  <div className="text-[9px] font-mono text-[var(--text-muted)] uppercase">Resources</div>
                  <div className="text-xs font-mono font-bold text-sky-300 mt-0.5 truncate">
                    {selectedMissionForDossier.known_resources || "Closed-Loop"}
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-[#1e3a5f] bg-[#020612] flex items-center justify-between gap-3">
              <button
                onClick={() => {
                  if (selectedMissionForDossier.description) {
                    navigator.clipboard.writeText(selectedMissionForDossier.description);
                  }
                }}
                className="px-3 py-1.5 rounded-lg border border-[#1e3a5f] bg-[#030914] text-xs font-mono text-slate-300 hover:text-white transition-colors"
              >
                Copy Text 📋
              </button>

              <div className="flex items-center gap-2">
                <Link
                  href={`/analysis?missionId=${selectedMissionForDossier.id}`}
                  className="px-3.5 py-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-xs font-mono font-semibold transition-colors"
                >
                  Analyze Mission →
                </Link>
                <Link
                  href={`/scenario-lab?missionId=${selectedMissionForDossier.id}`}
                  className="px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-semibold transition-colors"
                >
                  Scenario Lab →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Role-aware quick links — exactly matching role access spec */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {role === "mission_controller" && (
          <>
            <Link href="/missions/create" className="rounded-xl border border-[var(--border)] panel-glass p-4 hover:border-[var(--accent)] hover:bg-[var(--bg-card)] transition-all group">
              <div className="font-medium text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-glow)] mb-1 transition-colors">Create Mission →</div>
              <div className="text-xs text-[var(--text-muted)]">Start a new mission concept with AI-assisted planning</div>
            </Link>
            <Link href="/analysis" className="rounded-xl border border-[var(--border)] panel-glass p-4 hover:border-[var(--accent)] hover:bg-[var(--bg-card)] transition-all group">
              <div className="font-medium text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-glow)] mb-1 transition-colors">Mission Analysis →</div>
              <div className="text-xs text-[var(--text-muted)]">AI-powered analysis with document evidence</div>
            </Link>
          </>
        )}
        {role === "risk_analyst" && (
          <>
            <Link href="/scenario-lab" className="rounded-xl border border-[var(--amber)]/30 panel-glass p-4 hover:border-[var(--amber)]/60 hover:bg-[var(--bg-card)] transition-all group">
              <div className="font-medium text-sm text-[var(--text-primary)] group-hover:text-[var(--amber)] mb-1 transition-colors">Scenario Lab →</div>
              <div className="text-xs text-[var(--text-muted)]">Model mission variable changes and assess planning risk</div>
            </Link>
            <Link href="/missions/create" className="rounded-xl border border-[var(--border)] panel-glass p-4 hover:border-[var(--accent)] hover:bg-[var(--bg-card)] transition-all group">
              <div className="font-medium text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-glow)] mb-1 transition-colors">Create Mission →</div>
              <div className="text-xs text-[var(--text-muted)]">Start a new mission concept to analyze</div>
            </Link>
          </>
        )}
        {/* No role yet — shouldn't normally reach dashboard, but safe fallback */}
        {!role && (
          <Link href="/role-select" className="rounded-xl border border-[var(--amber)]/30 panel-glass p-4 hover:border-[var(--amber)]/60 hover:bg-[var(--bg-card)] transition-all group col-span-2">
            <div className="font-medium text-sm text-[var(--amber)] mb-1">Select your role →</div>
            <div className="text-xs text-[var(--text-muted)]">Choose Mission Controller or Risk Analyst to get started</div>
          </Link>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
