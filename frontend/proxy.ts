/**
 * Next.js 16 proxy entry point — replaces middleware.ts.
 *
 * Delegates all Auth0 route handling (login, callback, logout,
 * access-token, profile) to the Auth0 SDK via lib/auth0.ts.
 *
 * Note: proxy.ts does not support a `config` export — the matcher
 * is not used here; Next.js 16 routes all requests through proxy.ts
 * by convention.
 */
import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

export async function proxy(request: Request) {
  const url = new URL(request.url);

  // If the user cancelled/rejected authorization (e.g. error=access_denied), redirect smoothly to homepage
  if (url.pathname.startsWith("/auth/callback") && url.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Only invoke Auth0 middleware on /auth/* authentication endpoints
  if (url.pathname.startsWith("/auth/")) {
    return await auth0.middleware(request);
  }

  return NextResponse.next();
}
