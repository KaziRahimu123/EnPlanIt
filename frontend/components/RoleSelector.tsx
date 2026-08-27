"use client";

/**
 * RoleSelector — modal for switching roles from the NavBar.
 *
 * Only used after the user already has a role and wants to switch.
 * The initial role selection is handled by /role-select page.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useRole, ROLE_META } from "@/lib/RoleContext";
import type { UserRole } from "@/lib/api";

interface RoleSelectorProps {
  /** Called after role is successfully saved or dismissed */
  onClose: () => void;
}

export default function RoleSelector({ onClose }: RoleSelectorProps) {
  const [mounted, setMounted] = useState(false);
  const { role: currentRole, setRole } = useRole();
  const [selected, setSelected] = useState<UserRole | null>(currentRole ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const roles = Object.entries(ROLE_META) as [UserRole, (typeof ROLE_META)[UserRole]][];

  async function handleConfirm() {
    if (!selected || selected === currentRole) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await setRole(selected);
      onClose();
    } catch {
      setError("Failed to save role. Please try again.");
      setSaving(false);
    }
  }

  if (!mounted || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center px-4"
      style={{ background: "rgba(3,7,18,0.85)", backdropFilter: "blur(8px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-panel)] overflow-hidden shadow-2xl">
          {/* Header */}
          <div className="px-6 py-4 border-b border-[var(--border)] bg-[var(--bg-card)] flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-[var(--text-primary)]">Switch Role</h2>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Switching roles never affects your mission data.
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Role options */}
          <div className="p-4 space-y-3">
            {roles.map(([key, meta]) => {
              const isActive = selected === key;
              const isCurrent = currentRole === key;
              return (
                <button
                  key={key}
                  onClick={() => setSelected(key)}
                  className={`w-full text-left rounded-xl border p-4 transition-all ${
                    isActive
                      ? "border-[var(--accent)]/60 bg-[var(--accent)]/8"
                      : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--border-bright)] hover:bg-[var(--bg-panel)]"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`mt-0.5 w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-all ${
                        isActive
                          ? "bg-[var(--accent)]/20 text-[var(--accent-glow)] border border-[var(--accent)]/40"
                          : "bg-[var(--bg-panel)] text-[var(--text-muted)] border border-[var(--border)]"
                      }`}
                    >
                      {meta.short}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span
                          className={`text-sm font-semibold transition-colors ${
                            isActive ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                          }`}
                        >
                          {meta.label}
                        </span>
                        {isCurrent && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-[var(--green)]/40 bg-[var(--green)]/10 text-[var(--green)] font-semibold uppercase tracking-wider">
                            Current
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-[var(--text-muted)] leading-relaxed">
                        {meta.description}
                      </div>
                    </div>
                    <div className="ml-auto shrink-0 mt-1">
                      <div
                        className={`w-4 h-4 rounded-full border-2 transition-all ${
                          isActive
                            ? "border-[var(--accent)] bg-[var(--accent)]"
                            : "border-[var(--border)]"
                        }`}
                      >
                        {isActive && (
                          <svg viewBox="0 0 16 16" fill="none" className="w-full h-full">
                            <path d="M4 8l2.5 2.5L12 5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          {error && (
            <div className="mx-4 mb-2 rounded-lg border border-[var(--red)]/40 bg-[var(--red)]/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="px-4 pb-4 flex items-center gap-3">
            <button
              onClick={handleConfirm}
              disabled={!selected || saving}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              style={{
                background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
                boxShadow: selected && !saving ? "0 0 14px rgba(59,130,246,0.25)" : "none",
              }}
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
                  </svg>
                  Saving…
                </>
              ) : selected === currentRole ? (
                "Close"
              ) : (
                "Switch Role"
              )}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 rounded-lg text-sm border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:border-[var(--border-bright)] bg-[var(--bg-panel)] transition-all"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
