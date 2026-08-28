"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useUser } from "@auth0/nextjs-auth0/client";
import { useRole, ROLE_META } from "@/lib/RoleContext";
import RoleSelector from "@/components/RoleSelector";

export default function NavBar() {
  const pathname = usePathname();
  const { user, isLoading } = useUser();
  const { role, loading: roleLoading } = useRole();
  const [showRoleSwitcher, setShowRoleSwitcher] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  const displayEmail = user?.email ?? "";
  const displayName  = user?.name ?? displayEmail;
  const roleMeta = role ? ROLE_META[role] : null;

  // Nav links are role-filtered when a role is set; show all when no role yet
  const navLinks = roleMeta
    ? roleMeta.navLinks
    : [{ href: "/dashboard", label: "Dashboard" }];

  // Close the account dropdown when clicking outside
  useEffect(() => {
    if (!accountOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [accountOpen]);

  return (
    <>
      <header className="space-header sticky top-0 z-[100] border-b border-[var(--border)]">
        <nav className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
          {/* Wordmark — always links to / */}
          <Link href="/" className="flex items-center gap-2.5 group">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="EnPlanIt Logo"
              width={28}
              height={28}
              className="w-7 h-7 object-contain flex-shrink-0 group-hover:scale-105 transition-transform"
            />
            <span className="font-bold text-base tracking-wide text-[var(--text-primary)] group-hover:text-[var(--accent-glow)] transition-colors">
              EnPlanIt
            </span>
          </Link>

          {/* Nav links — auth-aware */}
          <ul className="hidden md:flex items-center gap-1">
            {/* Home is always shown */}
            <li>
              <Link
                href="/"
                className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                  pathname === "/"
                    ? "bg-[var(--accent-dim)] text-white"
                    : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
                }`}
              >
                Home
              </Link>
            </li>
            {/* Role-filtered authenticated links */}
            {user &&
              navLinks.map(({ href, label }) => {
                const isActive = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      className={`px-3 py-1.5 rounded text-sm font-medium transition-all ${
                        isActive
                          ? "bg-[var(--accent-dim)] text-white"
                          : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card)]"
                      }`}
                    >
                      {label}
                    </Link>
                  </li>
                );
              })}
          </ul>

          {/* Right-side controls */}
          <div className="flex items-center gap-2">

            {/* Role switcher badge — visible only when authenticated */}
            {!isLoading && user && (
              <button
                onClick={() => setShowRoleSwitcher(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border transition-all cursor-pointer hover:opacity-85"
                style={
                  roleMeta
                    ? {
                        borderColor: `color-mix(in srgb, ${roleMeta.color} 40%, transparent)`,
                        color: roleMeta.color,
                        background: `color-mix(in srgb, ${roleMeta.color} 10%, transparent)`,
                      }
                    : {
                        borderColor: "var(--border)",
                        color: "var(--text-muted)",
                        background: "var(--bg-card)",
                      }
                }
                title="Change active operations role"
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: roleMeta?.color ?? "var(--text-muted)" }}
                />
                <span className="font-semibold">
                  {roleLoading ? "…" : (roleMeta?.short ?? "ROLE")}
                </span>
              </button>
            )}

            {/* LOGGED IN — Account dropdown */}
            {!isLoading && user && (
              <div className="relative" ref={accountRef}>
                <button
                  onClick={() => setAccountOpen((prev) => !prev)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-panel)] text-[var(--text-primary)] transition-all cursor-pointer"
                  aria-haspopup="true"
                  aria-expanded={accountOpen}
                >
                  {/* Avatar — picture if available, otherwise coloured dot */}
                  {user.picture ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={user.picture}
                      alt=""
                      className="w-5 h-5 rounded-full object-cover flex-shrink-0"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="w-2 h-2 rounded-full bg-[var(--accent)] flex-shrink-0" />
                  )}
                  <span className="max-w-[160px] truncate font-medium">{displayName}</span>
                  {/* Chevron */}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    className={`flex-shrink-0 opacity-60 transition-transform duration-150 ${accountOpen ? "rotate-180" : ""}`}
                  >
                    <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>

                {/* Dropdown with high z-index and solid opaque dark surface */}
                {accountOpen && (
                  <div className="account-dropdown-menu">
                    {/* Identity section */}
                    <div className="px-4 py-3 border-b border-[var(--border)]" style={{ backgroundColor: "#060b17" }}>
                      <p className="text-[10px] font-mono text-[var(--text-muted)] uppercase tracking-widest mb-1">
                        Signed in as
                      </p>
                      <p className="text-xs font-bold text-white truncate" title={displayEmail}>
                        {displayName}
                      </p>
                      {displayEmail && displayName !== displayEmail && (
                        <p className="text-[11px] font-mono text-[var(--text-muted)] truncate mt-0.5" title={displayEmail}>
                          {displayEmail}
                        </p>
                      )}
                    </div>
                    {/* Actions */}
                    <div className="p-1.5" style={{ backgroundColor: "#080f20" }}>
                      <a
                        href="/auth/logout"
                        className="flex items-center gap-2.5 w-full px-3.5 py-2.5 rounded-lg text-xs font-semibold text-red-400 hover:text-white hover:bg-red-500/20 transition-all cursor-pointer"
                        onClick={() => {
                          setAccountOpen(false);
                          window.location.href = "/auth/logout";
                        }}
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="flex-shrink-0"
                        >
                          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        Log Out
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* LOGGED OUT — Sign In button */}
            {!isLoading && !user && (
              <a
                href="/auth/login?returnTo=/dashboard"
                onClick={() => {
                  window.location.href = "/auth/login?returnTo=/dashboard";
                }}
                className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white transition-all cursor-pointer"
                style={{
                  background: "linear-gradient(135deg, var(--accent-dim), var(--accent))",
                  boxShadow: "0 0 10px rgba(59,130,246,0.25)",
                }}
              >
                Sign In
              </a>
            )}

          </div>
        </nav>
      </header>

      {/* Role switcher modal */}
      {showRoleSwitcher && (
        <RoleSelector onClose={() => setShowRoleSwitcher(false)} />
      )}
    </>
  );
}
