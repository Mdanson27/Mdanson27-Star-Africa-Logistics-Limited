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
  if (!authClient) return null;

  // Neon Managed Better Auth exposes an opaque browser session token. Star
  // Africa's API validates that token server-side against neon_auth.session,
  // including session expiry and the linked user record.
  const result = await authClient.getSession();
  const data = result.data as { session?: { token?: unknown } } | null | undefined;
  const token = data?.session?.token;
  return typeof token === "string" && token.trim() ? token.trim() : null;
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
