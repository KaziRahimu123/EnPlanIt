"use client";

/**
 * /role-select — dedicated role-selection page.
 *
 * Reached after Auth0 sign-in when the user has not yet chosen a role.
 * Requires authentication (RequireAuth handles the redirect if not logged in).
 * Does NOT have a skip or dismiss option — role must be chosen to proceed.
 * After selecting, routes to the role-appropriate dashboard.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRole, ROLE_META } from "@/lib/RoleContext";
import RequireAuth from "@/components/RequireAuth";
import type { UserRole } from "@/lib/api";

function RoleSelectContent() {
  const router = useRouter();
  const { setRole } = useRole();
  const [selected, setSelected] = useState<UserRole | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = Object.entries(ROLE_META) as [
    UserRole,
    (typeof ROLE_META)[UserRole],
  ][];

  async function handleConfirm() {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      await setRole(selected);
      // Route to dashboard after role is saved
      router.replace("/dashboard");
    } catch {
      setError("Failed to save your role. Please try again.");
      setSaving(false);
    }
  }

  return (
    <div className="min-h-[calc(100vh-120px)] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          {/* Orbit icon */}
          <div className="flex justify-center mb-4">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="6" fill="var(--accent)" />
              <ellipse cx="24" cy="24" rx="20" ry="8" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.8" />
              <ellipse cx="24" cy="24" rx="20" ry="8" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.8" transform="rotate(60 24 24)" />
              <ellipse cx="24" cy="24" rx="20" ry="8" stroke="var(--accent)" strokeWidth="1.5" fill="none" opacity="0.8" transform="rotate(120 24 24)" />
            </svg>
          </div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[var(--border-bright)] bg-[var(--bg-card)] text-xs text-[var(--text-muted)] mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
            STEP 1 OF 1 — ROLE SELECTION
          </div>
          <h1 className="text-3xl font-bold text-white mb-2">
            Choose your role
          </h1>
          <p className="text-[var(--text-muted)] text-sm max-w-sm mx-auto leading-relaxed">
            Your role determines your default view and navigation. You can
            switch roles at any time from the navigation bar.
          </p>
        </div>

        {/* Role cards */}
        <div className="space-y-3 mb-6">
          {roles.map(([key, meta]) => {
            const isSelected = selected === key;
            return (
              <button
                key={key}
                onClick={() => setSelected(key)}
                className={`w-full text-left rounded-xl border p-5 transition-all ${
                  isSelected
                    ? "border-[var(--accent)]/60 bg-[var(--accent)]/8"
                    : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-bright)] hover:bg-[var(--bg-panel)]"
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Role badge */}
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 transition-all ${
                      isSelected
                        ? "bg-[var(--accent)]/20 text-[var(--accent-glow)] border border-[var(--accent)]/40"
                        : "bg-[var(--bg-panel)] text-[var(--text-muted)] border border-[var(--border)]"
                    }`}
                  >
                    {meta.short}
                  </div>

                  {/* Text */}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-base font-semibold mb-1 transition-colors ${
                        isSelected
                          ? "text-[var(--text-primary)]"
                          : "text-[var(--text-muted)]"
                      }`}
                    >
                      {meta.label}
                    </div>
                    <div className="text-sm text-[var(--text-muted)] leading-relaxed mb-2">
                      {meta.description}
                    </div>
                    {/* Access list */}
                    <div className="flex flex-wrap gap-1.5">
                      {meta.access.map((item) => (
                        <span
                          key={item}
                          className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-medium uppercase tracking-wider transition-colors ${
                            isSelected
                              ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent-glow)]"
                              : "border-[var(--border)] text-[var(--text-muted)]"
                          }`}
                        >
                          {item}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Radio indicator */}
                  <div className="shrink-0 mt-1">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        isSelected
                          ? "border-[var(--accent)] bg-[var(--accent)]"
                          : "border-[var(--border)]"
                      }`}
                    >
                      {isSelected && (
                        <svg viewBox="0 0 20 20" fill="none" className="w-full h-full">
                          <path
                            d="M5 10l3.5 3.5L15 7"
                            stroke="white"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-4 py-3 text-sm text-red-300">
            ⚠ {error}
          </div>
        )}

        {/* Confirm button — disabled until selection made */}
        <button
          onClick={handleConfirm}
          disabled={!selected || saving}
          className="w-full py-3.5 rounded-xl text-base font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
          style={{
            background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
            boxShadow:
              selected && !saving ? "0 0 20px rgba(59,130,246,0.3)" : "none",
          }}
        >
          {saving ? (
            <>
              <svg
                className="animate-spin h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8z"
                />
              </svg>
              Saving…
            </>
          ) : (
            <>
              Continue to Dashboard
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </>
          )}
        </button>

        <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
          You can switch roles any time from the navigation bar.
        </p>
      </div>
    </div>
  );
}

export default function RoleSelectPage() {
  // requireRole=false prevents an infinite redirect loop:
  // this page IS where you go when you have no role.
  return (
    <RequireAuth requireRole={false}>
      <RoleSelectContent />
    </RequireAuth>
  );
}
