/**
 * RequireAuth — redirects unauthenticated users to Auth0 login.
 *
 * When requireRole=true (default for protected pages), also redirects
 * authenticated-but-role-less users to /role-select.
 *
 * Pass requireRole=false on /role-select itself to avoid an infinite loop.
 */
"use client";

import { useUser } from "@auth0/nextjs-auth0/client";
import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useRole } from "@/lib/RoleContext";

interface RequireAuthProps {
  children: React.ReactNode;
  /** Check that the user has a role set. Default: true. Set false on /role-select. */
  requireRole?: boolean;
}

export default function RequireAuth({
  children,
  requireRole = true,
}: RequireAuthProps) {
  const { user, isLoading: authLoading } = useUser();
  const { role, loading: roleLoading } = useRole();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (authLoading) return;

    // Not logged in → Auth0 login, preserving intended destination
    if (!user) {
      router.replace(`/auth/login?returnTo=${encodeURIComponent(pathname)}`);
      return;
    }

    // Logged in but no role selected → role-select page
    if (requireRole && !roleLoading && !role) {
      router.replace("/role-select");
    }
  }, [user, authLoading, role, roleLoading, requireRole, pathname, router]);

  // Show spinner while Auth0 session is resolving
  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
          Checking authentication…
        </div>
      </div>
    );
  }

  // Not logged in — redirect already triggered, render nothing
  if (!user) return null;

  return <>{children}</>;
}
