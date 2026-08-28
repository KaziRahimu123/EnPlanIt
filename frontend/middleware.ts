import { type NextRequest, NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // If the user cancelled/rejected authorization (e.g. error=access_denied), redirect smoothly to homepage
  if (url.pathname.startsWith("/auth/callback") && url.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
