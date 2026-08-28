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

    // Only return the authentic RS256 Auth0 ID token from the verified session
    const idToken = session.tokenSet?.idToken;
    if (!idToken) {
      return NextResponse.json(
        { error: "No RS256 ID token present in active session" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      token: idToken,
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
