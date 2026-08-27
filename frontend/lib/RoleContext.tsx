"use client";

/**
 * RoleContext — manages the active user role for EnPlanIt.
 *
 * Roles: 'mission_controller' | 'risk_analyst' | null (not yet selected)
 *
 * Role is persisted to the backend (profiles table in Supabase) so it
 * survives page reloads and browser sessions. Switching roles never
 * affects mission data or requires a logout.
 *
 * The role-selection flow is route-based (/role-select), not modal-based.
 * RequireAuth redirects unauthenticated users; RequireRole (inside protected
 * pages) redirects role-less users to /role-select.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import { useUser } from "@auth0/nextjs-auth0/client";
import { getProfile, updateRole, type UserProfile, type UserRole } from "@/lib/api";

interface RoleContextValue {
  role: UserRole | null;
  profile: UserProfile | null;
  /** True while auth or profile is still loading */
  loading: boolean;
  /** Save a new role and update context */
  setRole: (role: UserRole) => Promise<void>;
}

const RoleContext = createContext<RoleContextValue>({
  role: null,
  profile: null,
  loading: true,
  setRole: async () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading } = useUser();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const savedLocalRole =
      typeof window !== "undefined"
        ? ((localStorage.getItem(`enplanit_role_${user.sub}`) ||
            localStorage.getItem(`astroops_role_${user.sub}`) ||
            "mission_controller") as UserRole)
        : ("mission_controller" as UserRole);

    getProfile()
      .then((p) => {
        const resolvedRole = p.role || savedLocalRole || "mission_controller";
        p.role = resolvedRole;
        setProfile(p);
        if (typeof window !== "undefined" && user.sub) {
          localStorage.setItem(`enplanit_role_${user.sub}`, resolvedRole);
        }
      })
      .catch(() => {
        setProfile({
          auth0_sub: user.sub ?? "",
          email: user.email,
          name: user.name,
          role: savedLocalRole,
        });
      })
      .finally(() => setLoading(false));
  }, [user, authLoading]);

  const setRole = useCallback(
    async (role: UserRole) => {
      if (user?.sub) {
        try {
          localStorage.setItem(`enplanit_role_${user.sub}`, role);
        } catch {}
      }
      try {
        const updated = await updateRole(role);
        setProfile(updated);
      } catch (err) {
        console.warn("Backend updateRole warning, using local role state:", err);
        setProfile((prev) => ({
          auth0_sub: user?.sub ?? prev?.auth0_sub ?? "",
          email: user?.email ?? prev?.email ?? null,
          name: user?.name ?? prev?.name ?? null,
          role: role,
        }));
      }
    },
    [user],
  );

  return (
    <RoleContext.Provider
      value={{
        role: profile?.role ?? null,
        profile,
        loading: authLoading || loading,
        setRole,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole(): RoleContextValue {
  return useContext(RoleContext);
}

/** Role display metadata */
export const ROLE_META: Record<
  NonNullable<UserRole>,
  {
    label: string;
    short: string;
    description: string;
    color: string;
    /** Pages this role can access (shown during selection) */
    access: string[];
    /** Nav links visible to this role */
    navLinks: Array<{ href: string; label: string }>;
  }
> = {
  mission_controller: {
    label: "Mission Controller",
    short: "MC",
    description:
      "Plan, create, and manage missions. Oversee the full mission lifecycle from concept to analysis.",
    color: "var(--accent)",
    access: ["Dashboard", "Create Mission", "Analysis"],
    navLinks: [
      { href: "/dashboard",       label: "Dashboard"       },
      { href: "/missions/create", label: "Create Mission"  },
      { href: "/analysis",        label: "Analysis"        },
    ],
  },
  risk_analyst: {
    label: "Mission Risk & Safety Analyst",
    short: "RA",
    description:
      "Assess mission risks, model scenario changes, and review planning concerns and safety posture.",
    color: "var(--amber)",
    access: ["Dashboard", "Scenario Lab", "Create Mission"],
    navLinks: [
      { href: "/dashboard",       label: "Dashboard"       },
      { href: "/scenario-lab",    label: "Scenario Lab"    },
      { href: "/missions/create", label: "Create Mission"  },
    ],
  },
};
