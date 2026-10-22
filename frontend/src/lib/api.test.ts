import { beforeEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  notifySessionExpired: vi.fn(),
}));

vi.mock("@/lib/authSession", () => authMocks);

import {
  authenticatedFetch,
  configureApiBaseUrl,
  getApiBaseUrl,
  parseApiError,
} from "@/lib/api";

describe("central authenticated API client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", {
      location: { origin: "https://starafrica.test" },
      setTimeout,
      clearTimeout,
    });
    configureApiBaseUrl("");
  });

  it("adds the Neon bearer token to protected API requests", async () => {
    authMocks.getAccessToken.mockResolvedValue("jwt-one");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await authenticatedFetch("/api/v1/projects");

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.headers.get("Authorization")).toBe("Bearer jwt-one");
  });

  it("refreshes the token once after a 401 and retries the request", async () => {
    authMocks.getAccessToken
      .mockResolvedValueOnce("stale-token")
      .mockResolvedValueOnce("fresh-token")
      .mockResolvedValueOnce("fresh-token");

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await authenticatedFetch("/api/v1/projects", { method: "POST" });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retry = fetchMock.mock.calls[1][0] as Request;
    expect(retry.headers.get("Authorization")).toBe("Bearer fresh-token");
    expect(authMocks.notifySessionExpired).not.toHaveBeenCalled();
  });

  it("expires the session when a refreshed token is still unauthorized", async () => {
    authMocks.getAccessToken.mockResolvedValue("still-invalid");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await authenticatedFetch("/api/v1/projects");

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(authMocks.notifySessionExpired).toHaveBeenCalledTimes(1);
  });

  it("recovers from an expired API host using the no-cache runtime config", async () => {
    configureApiBaseUrl("https://expired-tunnel.test");
    authMocks.getAccessToken.mockResolvedValue("jwt-one");

    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("DNS failure"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ apiUrl: "https://current-tunnel.test" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await authenticatedFetch(
      "https://expired-tunnel.test/api/v1/projects",
    );

    expect(response.status).toBe(200);
    expect(getApiBaseUrl()).toBe("https://current-tunnel.test");
    const retried = fetchMock.mock.calls[2][0] as Request;
    expect(retried.url).toBe("https://current-tunnel.test/api/v1/projects");
    expect(retried.headers.get("Authorization")).toBe("Bearer jwt-one");
  });

  it("recovers from a 503 gateway response when runtime config has a new API host", async () => {
    configureApiBaseUrl("https://expired-tunnel.test");
    authMocks.getAccessToken.mockResolvedValue("jwt-one");

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ apiUrl: "https://current-tunnel.test" }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await authenticatedFetch(
      "https://expired-tunnel.test/api/v1/projects",
    );

    expect(response.status).toBe(200);
    expect(getApiBaseUrl()).toBe("https://current-tunnel.test");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const retried = fetchMock.mock.calls[2][0] as Request;
    expect(retried.url).toBe("https://current-tunnel.test/api/v1/projects");
    expect(retried.headers.get("Authorization")).toBe("Bearer jwt-one");
  });
});

describe("API error messages", () => {
  it.each([
    [401, "could not verify"],
    [403, "do not have permission"],
    [404, "could not be found"],
    [409, "conflicts"],
    [422, "check"],
    [500, "temporarily unavailable"],
  ])("maps HTTP %s into a user-safe message", (status, phrase) => {
    const error = parseApiError(null, new Response(null, { status }));
    expect(error.status).toBe(status);
    expect(error.message.toLowerCase()).toContain(phrase);
  });

  it("does not expose raw network errors", () => {
    const error = parseApiError(new Error("ECONNRESET secret internal detail"));
    expect(error.message).toBe(
      "Star Africa Logistics could not reach the server. Check your connection and try again.",
    );
  });
});
