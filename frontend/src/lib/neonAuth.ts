import { createAuthClient } from "@neondatabase/neon-js/auth";

const authUrl = (import.meta.env.VITE_NEON_AUTH_URL || "").trim().replace(/\/$/, "");

export const isNeonAuthConfigured = Boolean(authUrl);

const authClient = isNeonAuthConfigured ? createAuthClient(authUrl) : null;

export type StarAfricaLogisticsNeonAuthClient = NonNullable<typeof authClient>;

export function getNeonAuthClient(): StarAfricaLogisticsNeonAuthClient {
  if (!authClient) {
    throw new Error("Star Africa Logistics authentication is not configured yet.");
  }
  return authClient;
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
