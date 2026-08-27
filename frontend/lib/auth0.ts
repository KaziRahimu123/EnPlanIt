import { Auth0Client } from "@auth0/nextjs-auth0/server";

const domain = (
  process.env.AUTH0_DOMAIN ||
  process.env.AUTH0_ISSUER_BASE_URL?.replace(/^https?:\/\//, "").replace(/\/$/, "") ||
  "dev-jtfzglakt184mmu5.us.auth0.com"
);

const authParams: Record<string, string> = {
  scope: "openid profile email",
};
if (
  process.env.AUTH0_AUDIENCE &&
  process.env.AUTH0_AUDIENCE !== "https://api.enplanit.local" &&
  !process.env.AUTH0_AUDIENCE.includes("example")
) {
  authParams.audience = process.env.AUTH0_AUDIENCE;
}

export const auth0 = new Auth0Client({
  domain,
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  secret: process.env.AUTH0_SECRET,
  appBaseUrl: process.env.AUTH0_BASE_URL ?? "http://localhost:3000",
  signInReturnToPath: "/dashboard",
  authorizationParameters: authParams,
});


