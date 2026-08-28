import { Auth0Client } from "@auth0/nextjs-auth0/server";

const domain = (
  process.env.AUTH0_DOMAIN?.trim() ||
  process.env.AUTH0_ISSUER_BASE_URL?.trim().replace(/^https?:\/\//, "").replace(/\/$/, "") ||
  "dev-jtfzglakt184mmu5.us.auth0.com"
);

const clientId = process.env.AUTH0_CLIENT_ID?.trim();
const clientSecret = process.env.AUTH0_CLIENT_SECRET?.trim();
const secret = process.env.AUTH0_SECRET?.trim();

const allowedOrigins: string[] = [];
if (process.env.APP_BASE_URL?.trim()) allowedOrigins.push(process.env.APP_BASE_URL.trim());
if (process.env.AUTH0_BASE_URL?.trim()) allowedOrigins.push(process.env.AUTH0_BASE_URL.trim());
if (process.env.VERCEL_URL?.trim()) allowedOrigins.push(`https://${process.env.VERCEL_URL.trim()}`);
allowedOrigins.push("http://localhost:3000", "http://127.0.0.1:3000");

const uniqueAllowedOrigins = Array.from(
  new Set(
    allowedOrigins.map((u) => {
      try {
        return new URL(u).origin;
      } catch {
        return u;
      }
    })
  )
);

const authParams: Record<string, string> = {
  scope: "openid profile email",
  prompt: "select_account",
};
const audience = (
  process.env.AUTH0_API_AUDIENCE?.trim() ||
  process.env.AUTH0_AUDIENCE?.trim()
);
if (
  audience &&
  audience !== "https://api.enplanit.local" &&
  !audience.includes("example")
) {
  authParams.audience = audience;
}

export const auth0 = new Auth0Client({
  domain,
  clientId,
  clientSecret,
  secret,
  appBaseUrl: uniqueAllowedOrigins,
  signInReturnToPath: "/dashboard",
  authorizationParameters: authParams,
});


