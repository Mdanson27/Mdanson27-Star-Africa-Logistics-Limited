import { createInternalNeonAuth } from "@neondatabase/neon-js/auth";

const authUrl = (import.meta.env.VITE_NEON_AUTH_URL || "").trim().replace(/\/$/, "");

export const isNeonAuthConfigured = Boolean(authUrl);

const neonAuth = isNeonAuthConfigured ? createInternalNeonAuth(authUrl) : null;
const authClient = neonAuth?.adapter ?? null;

export type StarAfricaLogisticsNeonAuthClient = NonNullable<typeof authClient>;

export function getNeonAuthClient(): StarAfricaLogisticsNeonAuthClient {
  if (!authClient) {
    throw new Error("Star Africa Logistics authentication is not configured yet.");
  }
  return authClient;
}

export async function getNeonAuthJWTToken(): Promise<string | null> {
  if (!neonAuth || !authUrl) return null;

  // Neon Managed Better Auth keeps the browser session token separate from the
  // JWKS-verifiable JWT used by external APIs. Request the short-lived signed
  // JWT from Better Auth's JWT plugin endpoint instead of reusing session.token.
  const response = await fetch(`${authUrl}/token`, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
    },
  });

  if (!response.ok) return null;

  const payload = (await response.json()) as { token?: unknown };
  return typeof payload.token === "string" && payload.token.trim()
    ? payload.token.trim()
    : null;
}

const STAR_AFRICA_GITHUB_PAGES_PATH = "/Mdanson27-Star-Africa-Logistics-Limited/";

export function getAuthCallbackUrl(): string {
  const basePath = window.location.hostname.endsWith(".github.io")
    ? STAR_AFRICA_GITHUB_PAGES_PATH
    : import.meta.env.BASE_URL || "/";
  const callbackUrl = new URL(basePath, window.location.origin);
  callbackUrl.search = "";
  callbackUrl.hash = "";
  return callbackUrl.toString();
}
