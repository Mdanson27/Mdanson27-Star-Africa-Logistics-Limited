import { beforeEach, describe, expect, it, vi } from "vitest";

const neonMocks = vi.hoisted(() => ({
  getJWTToken: vi.fn(),
}));

vi.mock("@/lib/neonAuth", () => ({
  isNeonAuthConfigured: true,
  getNeonAuthJWTToken: neonMocks.getJWTToken,
}));

class MemoryStorage {
  private data = new Map<string, string>();

  getItem(key: string) {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.data.set(key, value);
  }

  removeItem(key: string) {
    this.data.delete(key);
  }

  clear() {
    this.data.clear();
  }
}

function jwtExpiringIn(seconds: number): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + seconds }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

describe("Neon access-token session cache", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("localStorage", new MemoryStorage());
    vi.stubGlobal("sessionStorage", new MemoryStorage());
  });

  it("retrieves the signed Neon JWT and caches it for API requests", async () => {
    const token = jwtExpiringIn(3600);
    neonMocks.getJWTToken.mockResolvedValue(token);

    const session = await import("@/lib/authSession");

    expect(await session.getAccessToken()).toBe(token);
    expect(session.getCachedAccessToken()).toBe(token);
    expect(neonMocks.getJWTToken).toHaveBeenCalledTimes(1);

    expect(await session.getAccessToken()).toBe(token);
    expect(neonMocks.getJWTToken).toHaveBeenCalledTimes(1);
  });

  it("does not reuse an expired cached token after refresh", async () => {
    const expired = jwtExpiringIn(-60);
    const fresh = jwtExpiringIn(3600);
    localStorage.setItem("starafrica.access_token", expired);
    neonMocks.getJWTToken.mockResolvedValue(fresh);

    const session = await import("@/lib/authSession");

    expect(session.getCachedAccessToken()).toBeNull();
    expect(await session.getAccessToken()).toBe(fresh);
    expect(session.getCachedAccessToken()).toBe(fresh);
  });

  it("deduplicates simultaneous Neon JWT refresh requests", async () => {
    const token = jwtExpiringIn(3600);
    neonMocks.getJWTToken.mockResolvedValue(token);

    const session = await import("@/lib/authSession");
    const [first, second, third] = await Promise.all([
      session.getAccessToken(true),
      session.getAccessToken(true),
      session.getAccessToken(true),
    ]);

    expect(first).toBe(token);
    expect(second).toBe(token);
    expect(third).toBe(token);
    expect(neonMocks.getJWTToken).toHaveBeenCalledTimes(1);
  });

  it("falls back to a still-valid cached JWT when Neon JWT refresh is unavailable", async () => {
    const token = jwtExpiringIn(3600);
    localStorage.setItem("starafrica.access_token", token);
    neonMocks.getJWTToken.mockRejectedValue(new Error("Unauthorized"));

    const session = await import("@/lib/authSession");

    expect(await session.getAccessToken(true)).toBe(token);
    expect(session.getCachedAccessToken()).toBe(token);
  });
});
