import { auth0 } from "./lib/auth0";

export async function proxy(request: Request) {
  const url = new URL(request.url);

  // If the user cancelled/rejected authorization (e.g. error=access_denied), redirect smoothly to homepage
  if (url.pathname.startsWith("/auth/callback") && url.searchParams.has("error")) {
    return Response.redirect(new URL("/", request.url));
  }

  return await auth0.middleware(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
