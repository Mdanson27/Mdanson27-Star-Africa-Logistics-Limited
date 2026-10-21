export interface StarAfricaLogisticsRuntimeConfig {
  apiUrl?: string;
  updatedAt?: string;
}

export function normalizeApiUrl(value: string | null | undefined): string {
  const raw = (value || "").trim();
  if (!raw) return "";
  return raw.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
}

export function getBuildApiUrl(): string {
  return normalizeApiUrl(import.meta.env.VITE_API_URL);
}

function runtimeConfigUrl(): string {
  const basePath = import.meta.env.BASE_URL || "/";
  const url = new URL(
    `${basePath.replace(/\/$/, "")}/runtime-config.json`,
    window.location.origin,
  );
  url.searchParams.set("_", String(Date.now()));
  return url.toString();
}

export async function loadRuntimeApiUrl(): Promise<string> {
  const fallback = getBuildApiUrl();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2500);

  try {
    const response = await globalThis.fetch(runtimeConfigUrl(), {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return fallback;

    const config = (await response.json()) as StarAfricaLogisticsRuntimeConfig;
    return normalizeApiUrl(config.apiUrl) || fallback;
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timeout);
  }
}
