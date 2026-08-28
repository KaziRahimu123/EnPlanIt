/**
 * api.ts — EnPlanIt API client.
 *
 * authFetch attaches an Auth0 access token obtained via the
 * @auth0/nextjs-auth0 v4 client-side getAccessToken() helper.
 * The token is fetched from the /auth/access-token route managed by
 * the Auth0 middleware.
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL !== undefined
    ? process.env.NEXT_PUBLIC_API_URL
    : typeof window !== "undefined"
    ? ""
    : "http://localhost:8000";

// ---------------------------------------------------------------------------

let _cachedAccessToken: string | null = null;
let _tokenPromise: Promise<string | null> | null = null;

async function getClientAccessToken(): Promise<string | null> {
  if (_cachedAccessToken) return _cachedAccessToken;
  if (_tokenPromise) return _tokenPromise;

  _tokenPromise = (async () => {
    // 1. First attempt: retrieve verified token from /api/auth/token route
    try {
      const res = await fetch("/api/auth/token", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        if (
          data?.token &&
          typeof data.token === "string" &&
          data.token.trim() &&
          data.token !== "undefined" &&
          data.token !== "null"
        ) {
          _cachedAccessToken = data.token.trim();
          setTimeout(() => {
            _cachedAccessToken = null;
          }, 120000); // 2 minute cache
          return _cachedAccessToken;
        }
      }
    } catch {
      // Proceed to fallback
    }

    // 2. Second attempt: fallback to client SDK getAccessToken
    try {
      const { getAccessToken } = await import("@auth0/nextjs-auth0/client");
      const token = await Promise.race([
        getAccessToken(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 2500)),
      ]);
      if (
        token &&
        typeof token === "string" &&
        token.trim() &&
        token !== "undefined" &&
        token !== "null"
      ) {
        _cachedAccessToken = token.trim();
        setTimeout(() => {
          _cachedAccessToken = null;
        }, 120000); // 2 minute cache
        return _cachedAccessToken;
      }
      return null;
    } catch (err) {
      console.warn("Auth0 getAccessToken warning:", err);
      return null;
    } finally {
      _tokenPromise = null;
    }
  })();

  return _tokenPromise;
}

async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let token: string | null = null;
  if (typeof window !== "undefined") {
    token = await getClientAccessToken();
  }
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return fetch(url, { ...init, headers, credentials: "same-origin" });
}

export function parseApiError(err: unknown, fallback: string): string {
  if (!err) return fallback;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.detail === "string") return obj.detail;
    if (Array.isArray(obj.detail)) {
      return obj.detail
        .map((d: Record<string, unknown>) => {
          if (typeof d.msg === "string") {
            const loc = Array.isArray(d.loc) ? d.loc.slice(-1)[0] : null;
            return loc ? `${loc}: ${d.msg}` : d.msg;
          }
          return JSON.stringify(d);
        })
        .join("; ");
    }
    if (typeof obj.message === "string") return obj.message;
  }
  return fallback;
}

export async function healthCheck(): Promise<{ status: string; service: string }> {
  const res = await fetch(`${API_BASE}/api/health`);
  if (!res.ok) throw new Error("Health check failed");
  return res.json();
}

// ---------------------------------------------------------------------------
// Auth — legacy stubs kept for compatibility; no longer used for login/signup
// ---------------------------------------------------------------------------

export interface AuthUser {
  user_id: string;
  name: string;
  email: string;
}

export interface AuthResponse extends AuthUser {
  access_token: string;
  token_type: string;
}

/** @deprecated Auth0 handles signup — this stub is kept for type compatibility */
export async function apiSignup(_payload: {
  name: string;
  email: string;
  password: string;
  confirm_password: string;
}): Promise<AuthResponse> {
  throw new Error("Use Auth0 Universal Login for signup");
}

/** @deprecated Auth0 handles login — this stub is kept for type compatibility */
export async function apiLogin(_payload: {
  email: string;
  password: string;
}): Promise<AuthResponse> {
  throw new Error("Use Auth0 Universal Login for login");
}

export async function apiMe(): Promise<{ user_id: string; name: string; email: string; created_at: string }> {
  const res = await authFetch(`${API_BASE}/api/auth/me`);
  if (!res.ok) throw new Error("Not authenticated");
  return res.json();
}

// ---------------------------------------------------------------------------
// Missions
// ---------------------------------------------------------------------------

export interface MissionPayload {
  description: string;
  name?: string;
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  created_at: string;
  updated_at: string;
  status: string;
  destination?: string | null;
  mission_type?: string | null;
  objective?: string | null;
  duration?: string | null;
  power_source?: string | null;
  known_resources?: string | null;
  mission_summary?: string | null;
  objectives?: string | null;
  required_resources?: string | null;
  major_constraints?: string | null;
  planning_considerations?: string | null;
  missing_information?: string | null;
  has_scenario?: boolean;
}

export async function createMission(payload: MissionPayload): Promise<Mission> {
  const res = await authFetch(`${API_BASE}/api/missions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Failed to create mission");
  }
  return res.json();
}

export async function listMissions(): Promise<Mission[]> {
  const res = await authFetch(`${API_BASE}/api/missions`);
  if (!res.ok) throw new Error("Failed to fetch missions");
  return res.json();
}

export async function getMission(id: string): Promise<Mission> {
  const res = await authFetch(`${API_BASE}/api/missions/${id}`);
  if (!res.ok) throw new Error("Mission not found");
  return res.json();
}

export async function deleteMission(id: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/api/missions/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete mission");
}

// ---------------------------------------------------------------------------
// Scenario Lab types + API
// ---------------------------------------------------------------------------

export interface ScenarioVariables {
  mission_duration_days: number;
  solar_power_pct: number;
  battery_capacity_kwh: number;
  daily_power_consumption_kwh: number;
  communication_delay_min: number;
  resource_availability_pct: number;
}

export type ConcernLevel = "LOW" | "MEDIUM" | "HIGH" | "NOT_SPECIFIED";

export interface ConcernResult {
  level: ConcernLevel;
  reason: string;
}

export interface VariableChange {
  key: string;
  label: string;
  unit: string;
  before: number;
  after: number;
  changed: boolean;
}

export interface CascadingEffect {
  source_subsystem: string;
  impacted_subsystem: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  description: string;
}

export interface ReadinessDelta {
  score_before: number;
  score_after: number;
  delta: number;
  status_before: string;
  status_after: string;
  subsystem_scores_before: Record<string, number>;
  subsystem_scores_after: Record<string, number>;
}

export interface SubsystemMitigation {
  subsystem: string;
  concern_level: "LOW" | "MEDIUM" | "HIGH";
  recommendations: string[];
}

export interface EnvironmentalTelemetry {
  destination: string;
  solar_flux_w_m2: number;
  solar_flux_pct_of_earth: number;
  day_night_cycle_hours: number;
  max_eclipse_hours: number;
  crew_size: number;
  daily_water_burn_kg: number;
  daily_oxygen_burn_kg: number;
  total_consumables_mass_kg: number;
  estimated_radiation_msv: number;
}

export interface ScenarioRunResponse {
  mission_id: string | null;
  concerns_before: Record<string, ConcernResult>;
  concerns_after: Record<string, ConcernResult>;
  changes: VariableChange[];
  cascading_effects?: CascadingEffect[];
  readiness?: ReadinessDelta;
  mitigations?: SubsystemMitigation[];
  environment?: EnvironmentalTelemetry;
}

export async function runScenario(
  missionId: string | null,
  before: ScenarioVariables,
  after: ScenarioVariables,
  save = false,
): Promise<ScenarioRunResponse> {
  const endpoint = save ? "/api/scenarios/run/save" : "/api/scenarios/run";
  const res = await authFetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mission_id: missionId, before, after }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiError(err, "Scenario run failed"));
  }
  return res.json();
}

export interface SavedScenario {
  mission_id: string;
  before_vars: ScenarioVariables | null;
  after_vars: ScenarioVariables | null;
  concerns_before: Record<string, ConcernResult> | null;
  concerns_after: Record<string, ConcernResult> | null;
  changes: VariableChange[] | null;
  insights: ScenarioInsights | null;
  updated_at: string | null;
}

export async function getSavedScenario(missionId: string): Promise<SavedScenario> {
  const res = await authFetch(`${API_BASE}/api/scenarios/saved/${missionId}`);
  if (!res.ok) throw new Error("Failed to load saved scenario");
  return res.json();
}

// ---------------------------------------------------------------------------
// Mission Analysis (AI)
// ---------------------------------------------------------------------------

export interface MissionExtracted {
  destination: string;
  mission_type: string;
  objective: string;
  duration: string;
  power_source: string;
  known_resources: string;
}

export interface MissionPlan {
  mission_summary: string;
  objectives: string;
  required_resources: string;
  major_constraints: string;
  planning_considerations: string;
  missing_information: string;
}

export interface MissionAnalysisResponse {
  mission_id: string | null;
  extracted: MissionExtracted | null;
  plan: MissionPlan | null;
  ai_available: boolean;
  error: string | null;
}

export async function analyzeMission(
  missionId: string | null,
  description: string,
  save = false,
): Promise<MissionAnalysisResponse> {
  const endpoint = save ? "/api/analysis/analyze/save" : "/api/analysis/analyze";
  const res = await authFetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mission_id: missionId, description }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiError(err, "Analysis request failed"));
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Scenario AI Insights
// ---------------------------------------------------------------------------

export interface ScenarioInsights {
  what_changed: string;
  why_it_matters: string;
  possible_mission_impact: string;
  what_to_investigate_next: string;
}

export interface ScenarioInsightsResponse {
  mission_id: string | null;
  insights: ScenarioInsights | null;
  ai_available: boolean;
  error: string | null;
}

export async function getScenarioInsights(
  missionId: string | null,
  missionContext: string | null,
  concernsBefore: Record<string, ConcernResult>,
  concernsAfter: Record<string, ConcernResult>,
  changes: VariableChange[],
  save = false,
): Promise<ScenarioInsightsResponse> {
  const endpoint = save ? "/api/scenarios/insights/save" : "/api/scenarios/insights";
  const res = await authFetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mission_id: missionId,
      mission_context: missionContext,
      concerns_before: concernsBefore,
      concerns_after: concernsAfter,
      changes,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(parseApiError(err, "Insights request failed"));
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Profile & Role
// ---------------------------------------------------------------------------

export type UserRole = "mission_controller" | "risk_analyst";

export interface UserProfile {
  auth0_sub: string;
  email?: string | null;
  name?: string | null;
  role?: UserRole | null;
}

export async function getProfile(): Promise<UserProfile> {
  const res = await authFetch(`${API_BASE}/api/profile`);
  if (!res.ok) throw new Error("Failed to fetch profile");
  return res.json();
}

export async function updateRole(role: UserRole): Promise<UserProfile> {
  const res = await authFetch(`${API_BASE}/api/profile/role`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!res.ok) throw new Error("Failed to update role");
  return res.json();
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export interface MissionDocument {
  id: string;
  mission_id: string;
  filename: string;
  file_type: string;
  file_size: number;
  status: "uploaded" | "processing" | "ready" | "error";
  page_count?: number | null;
  word_count?: number | null;
  error_message?: string | null;
  uploaded_at: string;
  processed_at?: string | null;
}

export interface DocumentFact {
  id: string;
  category: string;
  field_key: string;
  label: string;
  value?: string | null;
  numeric_value?: number | null;
  unit?: string | null;
  state: "confirmed" | "extracted" | "not_specified" | "needs_review";
  source_text?: string | null;
  page_number?: number | null;
  document_id?: string | null;
  extracted_at: string;
}

export interface MissionFactsResponse {
  mission_id: string;
  facts: DocumentFact[];
  document_count: number;
  has_documents: boolean;
}

export async function uploadDocument(
  missionId: string,
  file: File,
): Promise<MissionDocument> {
  const form = new FormData();
  form.append("file", file);
  const res = await authFetch(`${API_BASE}/api/missions/${missionId}/documents`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail ?? "Upload failed");
  }
  return res.json();
}

export async function listDocuments(missionId: string): Promise<MissionDocument[]> {
  const res = await authFetch(`${API_BASE}/api/missions/${missionId}/documents`);
  if (!res.ok) throw new Error("Failed to list documents");
  return res.json();
}

export async function deleteDocument(
  missionId: string,
  documentId: string,
): Promise<void> {
  const res = await authFetch(
    `${API_BASE}/api/missions/${missionId}/documents/${documentId}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error("Failed to delete document");
}

export async function getMissionFacts(missionId: string): Promise<MissionFactsResponse> {
  const res = await authFetch(`${API_BASE}/api/missions/${missionId}/facts`);
  if (!res.ok) throw new Error("Failed to load mission facts");
  return res.json();
}

// ---------------------------------------------------------------------------
// Scenario BEFORE values (from document facts)
// ---------------------------------------------------------------------------

export interface BeforeValueInfo {
  key: string;
  label: string;
  unit: string;
  value: number | null;      // null = NOT PROVIDED
  state: "confirmed" | "extracted" | "not_specified" | "needs_review" | "default";
  source_label?: string | null;
  source_text?: string | null;
}

export interface MissionBeforeValuesResponse {
  mission_id: string;
  values: BeforeValueInfo[];
  has_document_data: boolean;
  is_aerospace_mission?: boolean;
  non_aerospace_warning?: string | null;
}

export async function getMissionBeforeValues(
  missionId: string,
): Promise<MissionBeforeValuesResponse> {
  const res = await authFetch(`${API_BASE}/api/scenarios/before-values/${missionId}`);
  if (!res.ok) throw new Error("Failed to load BEFORE values");
  return res.json();
}
