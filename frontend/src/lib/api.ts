import { client } from "@/client/client.gen";
import {
  getAccessToken,
  notifySessionExpired,
} from "@/lib/authSession";
import {
  getBuildApiUrl,
  loadRuntimeApiUrl,
  normalizeApiUrl,
} from "@/lib/runtimeConfig";

export class ApiError extends Error {
  status?: number;
  data?: unknown;
  retryAfter?: number;

  constructor(message: string, status?: number, data?: unknown, retryAfter?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
    this.retryAfter = retryAfter;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

function extractMessage(error: unknown): string | null {
  if (typeof error === "string" && error.trim()) return error.trim();
  if (!error || typeof error !== "object") return null;

  const raw = error as Record<string, unknown>;
  if (typeof raw.detail === "string" && raw.detail.trim()) return raw.detail.trim();
  if (Array.isArray(raw.detail) && raw.detail.length) {
    return raw.detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return String(item);
        const row = item as Record<string, unknown>;
        return String(row.msg || row.message || "Invalid value");
      })
      .join("; ");
  }
  if (typeof raw.error === "string" && raw.error.trim()) return raw.error.trim();
  if (typeof raw.message === "string" && raw.message.trim()) return raw.message.trim();
  return null;
}

export function parseApiError(error: unknown, response?: Response): ApiError {
  if (!response) {
    return new ApiError(
      "Star Africa Logistics could not reach the server. Check your connection and try again.",
      0,
      error,
    );
  }

  const status = response.status;
  const backendMessage = extractMessage(error);

  if (status === 401) {
    return new ApiError(
      "Star Africa Logistics could not verify your secure session. Please sign in again.",
      status,
      error,
    );
  }
  if (status === 403) {
    return new ApiError(
      "You do not have permission to perform this action.",
      status,
      error,
    );
  }
  if (status === 404) {
    return new ApiError(backendMessage || "The requested record could not be found.", status, error);
  }
  if (status === 409) {
    return new ApiError(
      backendMessage || "This record conflicts with existing information.",
      status,
      error,
    );
  }
  if (status === 422) {
    return new ApiError(
      backendMessage || "Please check the highlighted information and try again.",
      status,
      error,
    );
  }
  if (status === 429) {
    const headerValue = response.headers.get("Retry-After");
    const parsedHeader = headerValue ? Number.parseInt(headerValue, 10) : Number.NaN;
    const retryAfter = Number.isFinite(parsedHeader) && parsedHeader > 0 ? parsedHeader : undefined;
    return new ApiError(
      retryAfter
        ? `Too many requests. Please wait ${retryAfter} seconds and try again.`
        : "Too many requests. Please wait a moment and try again.",
      status,
      error,
      retryAfter,
    );
  }
  if (status >= 500) {
    return new ApiError(
      "Star Africa Logistics is temporarily unavailable. Please try again shortly.",
      status,
      error,
    );
  }

  return new ApiError(
    backendMessage || response.statusText || "The request could not be completed.",
    status,
    error,
  );
}

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

let apiBaseUrl = getBuildApiUrl();

export function getApiBaseUrl(): string {
  return apiBaseUrl;
}

function getApiPrefix(): string {
  return `${apiBaseUrl}/api/v1`;
}

export function configureApiBaseUrl(value: string): string {
  apiBaseUrl = normalizeApiUrl(value);
  client.setConfig({
    baseUrl: apiBaseUrl,
    auth: async () => (await getAccessToken()) || "",
    fetch: authenticatedFetch,
  });
  return apiBaseUrl;
}

const RETRYABLE_STATUSES = new Set([502, 503, 504]);

const sleep = (milliseconds: number) =>
  new Promise((resolve) => window.setTimeout(resolve, milliseconds));

function asRequest(input: RequestInfo | URL, init?: RequestInit): Request {
  if (typeof input === "string" && input.startsWith("/")) {
    return new Request(new URL(input, window.location.origin), init);
  }
  return new Request(input, init);
}

function isApiServerRequest(request: Request): boolean {
  const target = new URL(request.url);
  const expectedOrigin = apiBaseUrl
    ? new URL(apiBaseUrl).origin
    : window.location.origin;
  return target.origin === expectedOrigin;
}

function isProtectedApiRequest(request: Request): boolean {
  const target = new URL(request.url);
  const expected = apiBaseUrl
    ? new URL(getApiPrefix())
    : new URL("/api/v1", window.location.origin);
  return target.origin === expected.origin && target.pathname.startsWith(expected.pathname);
}

function rebaseApiRequest(request: Request, nextBaseUrl: string): Request {
  const target = new URL(request.url);
  const nextUrl = new URL(
    `${target.pathname}${target.search}`,
    nextBaseUrl || window.location.origin,
  );
  return new Request(nextUrl, request.clone());
}

async function recoverApiBaseUrl(request: Request): Promise<Request | null> {
  if (!isApiServerRequest(request)) return null;
  const nextBaseUrl = await loadRuntimeApiUrl();
  if (!nextBaseUrl || nextBaseUrl === apiBaseUrl) return null;
  configureApiBaseUrl(nextBaseUrl);
  return rebaseApiRequest(request, nextBaseUrl);
}

async function requestWithToken(baseRequest: Request, forceRefresh = false): Promise<Request> {
  if (!isProtectedApiRequest(baseRequest)) return baseRequest.clone();

  const token = await getAccessToken(forceRefresh);
  const headers = new Headers(baseRequest.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  else headers.delete("Authorization");

  return new Request(baseRequest.clone(), { headers });
}

export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  let baseRequest = asRequest(input, init);
  let protectedRequest = isProtectedApiRequest(baseRequest);
  const retryTemporaryFailure = ["GET", "HEAD"].includes(baseRequest.method.toUpperCase());

  let authRetried = false;
  let temporaryRetries = 0;
  let runtimeConfigRetried = false;

  while (true) {
    const request = await requestWithToken(baseRequest);

    let response: Response;
    try {
      response = await globalThis.fetch(request);
    } catch (error) {
      if (!runtimeConfigRetried) {
        runtimeConfigRetried = true;
        const recovered = await recoverApiBaseUrl(baseRequest);
        if (recovered) {
          baseRequest = recovered;
          protectedRequest = isProtectedApiRequest(baseRequest);
          temporaryRetries = 0;
          continue;
        }
      }
      if (retryTemporaryFailure && temporaryRetries < 2) {
        temporaryRetries += 1;
        await sleep(300 * 2 ** (temporaryRetries - 1));
        continue;
      }
      throw error;
    }

    if (protectedRequest && response.status === 401 && !authRetried) {
      authRetried = true;
      const refreshedToken = await getAccessToken(true);
      if (refreshedToken) continue;
      notifySessionExpired();
      return response;
    }

    if (protectedRequest && response.status === 401) {
      notifySessionExpired();
      return response;
    }

    if (retryTemporaryFailure && RETRYABLE_STATUSES.has(response.status)) {
      // A Cloudflare gateway can still return a real 502/503/504 response when
      // an old tunnel hostname has expired. Re-read runtime-config before
      // retrying the same dead origin so an updated API URL can take over
      // immediately without forcing the user to reload the application.
      if (!runtimeConfigRetried) {
        runtimeConfigRetried = true;
        const recovered = await recoverApiBaseUrl(baseRequest);
        if (recovered) {
          baseRequest = recovered;
          protectedRequest = isProtectedApiRequest(baseRequest);
          temporaryRetries = 0;
          continue;
        }
      }

      if (temporaryRetries < 2) {
        temporaryRetries += 1;
        await sleep(300 * 2 ** (temporaryRetries - 1));
        continue;
      }
    }

    return response;
  }
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

interface ApiReadCacheEntry {
  data: unknown;
  freshUntil: number;
  staleUntil: number;
}

const API_READ_FRESH_MS = 20_000;
const API_READ_STALE_MS = 15 * 60_000;
const apiReadCache = new Map<string, ApiReadCacheEntry>();
const apiReadInflight = new Map<string, Promise<unknown>>();

export function invalidateApiReadCache(pathPrefix?: string): void {
  if (!pathPrefix) {
    apiReadCache.clear();
    return;
  }
  for (const key of apiReadCache.keys()) {
    if (key.includes(pathPrefix)) apiReadCache.delete(key);
  }
}

function canUseStaleRead(error: unknown): boolean {
  if (!(error instanceof ApiError)) return true;
  return error.status === 0 || error.status === 429 || (error.status ?? 0) >= 500;
}

export async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const method = (options.method || "GET").toUpperCase();
  const isRead = method === "GET" || method === "HEAD";
  const cacheKey = `${method}:${path}`;
  const now = Date.now();
  const cached = isRead ? apiReadCache.get(cacheKey) : undefined;

  if (cached && cached.freshUntil > now) return cached.data as T;

  if (isRead) {
    const existing = apiReadInflight.get(cacheKey);
    if (existing) return (await existing) as T;
  } else {
    // Any mutation can change multiple dashboards and derived totals. Clearing the
    // short-lived read cache keeps follow-up views correct without forcing each
    // component to know which other endpoints became stale.
    invalidateApiReadCache();
  }

  const execute = async (): Promise<T> => {
    const headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    if (options.body !== undefined && !(options.body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }

    let response: Response;
    try {
      response = await authenticatedFetch(`${getApiPrefix()}${path}`, {
        ...options,
        headers,
      });
    } catch (error) {
      const parsed = parseApiError(error);
      if (cached && cached.staleUntil > Date.now() && canUseStaleRead(parsed)) {
        return cached.data as T;
      }
      throw parsed;
    }

    if (!response.ok) {
      const body = await readErrorBody(response);
      const parsed = parseApiError(body, response);
      if (cached && cached.staleUntil > Date.now() && canUseStaleRead(parsed)) {
        return cached.data as T;
      }
      throw parsed;
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    const data = (text ? JSON.parse(text) : undefined) as T;
    if (isRead) {
      const savedAt = Date.now();
      apiReadCache.set(cacheKey, {
        data,
        freshUntil: savedAt + API_READ_FRESH_MS,
        staleUntil: savedAt + API_READ_STALE_MS,
      });
    }
    return data;
  };

  if (!isRead) return execute();

  const promise = execute();
  apiReadInflight.set(cacheKey, promise as Promise<unknown>);
  try {
    return await promise;
  } finally {
    if (apiReadInflight.get(cacheKey) === promise) apiReadInflight.delete(cacheKey);
  }
}

configureApiBaseUrl(apiBaseUrl);

client.interceptors.error.use((error, response, request, options) => {
  const parsedError = parseApiError(error, response);

  if (import.meta.env.DEV) {
    console.warn(`[API Error ${response?.status ?? "Network"}]:`, {
      message: parsedError.message,
      status: parsedError.status,
      retryAfter: parsedError.retryAfter,
      url: request?.url || (options as { url?: string })?.url,
    });
  }

  return parsedError;
});

export { client };
