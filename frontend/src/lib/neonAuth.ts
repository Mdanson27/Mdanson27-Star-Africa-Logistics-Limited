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

export function getAuthCallbackUrl(): string {
  return new URL(import.meta.env.BASE_URL || "/", window.location.origin).toString();
}
