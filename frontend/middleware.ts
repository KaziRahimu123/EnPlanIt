import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { auth0 } from "./lib/auth0";

export async function middleware(request: NextRequest) {
  const url = request.nextUrl;

  // If the user cancelled/rejected authorization (e.g. error=access_denied), redirect smoothly to homepage
  if (url.pathname.startsWith("/auth/callback") && url.searchParams.has("error")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  try {
    return await auth0.middleware(request);
  } catch (error) {
    console.error("Auth middleware error:", error);
    if (url.pathname.startsWith("/auth/callback") || url.pathname.startsWith("/auth/login")) {
      return NextResponse.redirect(new URL("/?auth_error=1", request.url));
    }
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
