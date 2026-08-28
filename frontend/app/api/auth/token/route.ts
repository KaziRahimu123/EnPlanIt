import { auth0 } from "@/lib/auth0";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // Retrieve RS256 ID token or access token from the verified Auth0 session
    const s = session as unknown as Record<string, unknown>;
    const tokenSet = (s.tokenSet as Record<string, unknown>) || {};
    
    const validToken =
      (typeof s.idToken === "string" && s.idToken) ||
      (typeof tokenSet.idToken === "string" && tokenSet.idToken) ||
      (typeof tokenSet.id_token === "string" && tokenSet.id_token) ||
      (typeof s.accessToken === "string" && s.accessToken) ||
      (typeof tokenSet.accessToken === "string" && tokenSet.accessToken) ||
      (typeof tokenSet.access_token === "string" && tokenSet.access_token);

    if (!validToken) {
      return NextResponse.json(
        { error: "No RS256 token present in active session" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      token: validToken,
      user: session.user,
    });
  } catch (err) {
    console.error("Failed to retrieve session token:", err);
    return NextResponse.json(
      { error: "Failed to retrieve session token" },
      { status: 500 }
    );
  }
}
