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
  if (!neonAuth) return null;
  return neonAuth.getJWTToken();
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
