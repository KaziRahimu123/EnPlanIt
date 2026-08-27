"use client";

/**
 * /missions/[mission_id] — redirect to the Analysis page for this mission.
 *
 * The core Analysis workflow lives at /analysis?missionId=<id>.
 * This route provides clean /missions/<id> URLs and enforces authentication
 * before any redirect occurs.
 */

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import RequireAuth from "@/components/RequireAuth";

function MissionRedirect() {
  const params = useParams<{ mission_id: string }>();
  const router = useRouter();

  useEffect(() => {
    if (params.mission_id) {
      router.replace(`/analysis?missionId=${params.mission_id}`);
    }
  }, [params.mission_id, router]);

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Loading mission…
      </div>
    </div>
  );
}

export default function MissionPage() {
  return (
    <RequireAuth>
      <MissionRedirect />
    </RequireAuth>
  );
}
