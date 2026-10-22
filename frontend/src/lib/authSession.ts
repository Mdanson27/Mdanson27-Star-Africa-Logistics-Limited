import { getNeonAuthJWTToken, isNeonAuthConfigured } from "@/lib/neonAuth";

const ACCESS_TOKEN_KEY = "starafrica.access_token";
const AUTH_NOTICE_KEY = "starafrica.authNotice";
const TOKEN_REFRESH_SKEW_SECONDS = 60;

export const AUTH_SESSION_EXPIRED_EVENT = "starafrica:auth-session-expired";

let tokenRefreshPromise: Promise<string | null> | null = null;

function decodeJwtExpiry(token: string): number | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;

    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded)) as { exp?: unknown };

    return typeof decoded.exp === "number" ? decoded.exp : null;
  } catch {
    return null;
  }
}

function isTokenFresh(token: string): boolean {
  const expiry = decodeJwtExpiry(token);
  if (!expiry) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  return expiry - nowSeconds > TOKEN_REFRESH_SKEW_SECONDS;
}

export function getCachedAccessToken(): string | null {
  const token = localStorage.getItem(ACCESS_TOKEN_KEY)?.trim() || null;
  return token && isTokenFresh(token) ? token : null;
}

export function cacheAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
}

export function clearCachedAccessToken(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY);
}

export function notifySessionExpired(): void {
  clearCachedAccessToken();
  sessionStorage.setItem(
    AUTH_NOTICE_KEY,
    "Your Star Africa Logistics session expired. Please sign in again to continue.",
  );
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT));
}

export function consumeAuthNotice(): string | null {
  const notice = sessionStorage.getItem(AUTH_NOTICE_KEY);
  if (notice) sessionStorage.removeItem(AUTH_NOTICE_KEY);
  return notice;
}

export async function getAccessToken(forceRefresh = false): Promise<string | null> {
  if (!isNeonAuthConfigured) {
    clearCachedAccessToken();
    return null;
  }

  const cached = getCachedAccessToken();
  if (!forceRefresh && cached) {
    return cached;
  }

  if (tokenRefreshPromise) {
    return tokenRefreshPromise;
  }

  tokenRefreshPromise = (async () => {
    try {
      // Better Auth's session.token is a browser session identifier, not the
      // signed JWT our API validates against Neon JWKS. getNeonAuthJWTToken()
      // exchanges the authenticated cookie session through the /token endpoint.
      const token = await getNeonAuthJWTToken();

      if (!token || !isTokenFresh(token)) {
        if (cached) return cached;
        clearCachedAccessToken();
        return null;
      }

      cacheAccessToken(token);
      return token;
    } catch {
      if (cached) return cached;
      clearCachedAccessToken();
      return null;
    } finally {
      tokenRefreshPromise = null;
    }
  })();

  return tokenRefreshPromise;
}
