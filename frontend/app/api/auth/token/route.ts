import { auth0 } from "@/lib/auth0";
import { NextResponse } from "next/server";

async function signHs256Jwt(
  payload: Record<string, unknown>,
  secret: string
): Promise<string> {
  const encoder = new TextEncoder();
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = Buffer.from(JSON.stringify(header)).toString("base64url");
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  const encodedSignature = Buffer.from(signature).toString("base64url");
  return `${data}.${encodedSignature}`;
}

export async function GET() {
  try {
    const session = await auth0.getSession();
    if (!session || !session.user) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const secret =
      process.env.AUTH0_SECRET?.trim() ||
      process.env.JWT_SECRET_KEY?.trim() ||
      "c8f93a10b42e71d5e68b4f02a39c18d72f9104e5a638b1d7c92e54a108b39d42";

    // 1. Prefer Auth0 RS256 idToken if available
    let token = session.tokenSet?.idToken;

    // 2. If idToken is not directly available, create a verified HS256 JWT signed with AUTH0_SECRET
    if (!token && session.user.sub) {
      const now = Math.floor(Date.now() / 1000);
      const payload = {
        sub: session.user.sub,
        email: session.user.email ?? "",
        name: session.user.name ?? "",
        picture: session.user.picture ?? "",
        iat: now,
        exp: now + 3600 * 24 * 7, // 7 days
      };
      token = await signHs256Jwt(payload, secret);
    }

    return NextResponse.json({
      token: token || null,
      user: session.user,
    });
  } catch (err) {
    console.error("Failed to generate session auth token:", err);
    return NextResponse.json(
      { error: "Failed to generate token" },
      { status: 500 }
    );
  }
}
