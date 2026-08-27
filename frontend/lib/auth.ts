/**
 * Auth helpers — Auth0 session wrappers.
 *
 * All session data comes from the @auth0/nextjs-auth0 SDK.
 * This module is imported ONLY in client components ("use client").
 */

export interface AuthUser {
  user_id: string;
  name: string;
  email: string;
}

/**
 * Legacy compatibility stubs — these are no-ops now that Auth0 manages sessions.
 * Kept so pages that still call them compile without changes.
 */
export function saveSession(_token: string, _user: AuthUser): void {
  // Auth0 SDK manages the session — nothing to do here
}

export function clearSession(): void {
  // Logout is handled by /api/auth/logout — nothing to do here
}

export function getToken(): string | null {
  // Tokens are now obtained server-side via getAccessToken().
  // Client-side token retrieval is not used in the new flow.
  return null;
}

export function getUser(): AuthUser | null {
  // Use the useUser() hook from @auth0/nextjs-auth0 in client components instead.
  return null;
}

export function isLoggedIn(): boolean {
  // Use the useUser() hook from @auth0/nextjs-auth0 in client components instead.
  return false;
}

export function authHeaders(
  extra: Record<string, string> = {},
): Record<string, string> {
  return { ...extra };
}
