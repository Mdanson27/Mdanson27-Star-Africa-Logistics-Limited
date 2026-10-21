import { beforeEach, describe, expect, it, vi } from "vitest";

describe("Star Africa Neon Auth callback", () => {
  beforeEach(() => {
    vi.resetModules();
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
  });
});
