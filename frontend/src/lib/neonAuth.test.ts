import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Star Africa Neon Auth callback", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("returns Google OAuth to the Star Africa GitHub Pages application path", async () => {
    vi.stubGlobal("window", {
      location: {
        hostname: "mdanson27.github.io",
        origin: "https://mdanson27.github.io",
      },
    });

    const { getAuthCallbackUrl } = await import("@/lib/neonAuth");

    expect(getAuthCallbackUrl()).toBe(
      "https://mdanson27.github.io/Mdanson27-Star-Africa-Logistics-Limited/",
    );
  }, 15_000);

  it("removes the consumed Neon verifier without changing the application path", async () => {
    const replaceState = vi.fn();
    vi.stubGlobal("document", { title: "Star Africa Logistics" });
    vi.stubGlobal("window", {
      location: {
        href: "https://mdanson27.github.io/Mdanson27-Star-Africa-Logistics-Limited/?neon_auth_session_verifier=abc123&keep=1",
        hostname: "mdanson27.github.io",
        origin: "https://mdanson27.github.io",
      },
      history: { replaceState },
    });

    const { clearAuthCallbackVerifier } = await import("@/lib/neonAuth");
    clearAuthCallbackVerifier();

    expect(replaceState).toHaveBeenCalledWith(
      {},
      "Star Africa Logistics",
      "/Mdanson27-Star-Africa-Logistics-Limited/?keep=1",
    );
  });
});
