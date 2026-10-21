import { beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({
  apiRequest: vi.fn(),
  authenticatedFetch: vi.fn(),
  getApiBaseUrl: vi.fn(() => "https://api.starafrica.test"),
}));

vi.mock("@/lib/api", () => apiMocks);

import { businessApi } from "@/lib/businessApi";

describe("Business API reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.getApiBaseUrl.mockReturnValue("https://api.starafrica.test");
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:starafrica-receipt-preview"),
    });
  });

  it("uses the saved receipt preview URL without a duplicate PDF request", async () => {
    apiMocks.apiRequest.mockResolvedValue({
      document_id: "doc-1",
      document_number: "RCT-2026-0001",
      filename: "RCT-2026-0001.pdf",
      download_url: "https://storage.test/signed-receipt.pdf",
      stored: true,
    });

    const preview = await businessApi.previewReceipt("payment-1");

    expect(apiMocks.apiRequest).toHaveBeenCalledWith(
      "/business/receipts/payment-1/preview",
      { method: "POST" },
    );
    expect(apiMocks.authenticatedFetch).not.toHaveBeenCalled();
    expect(preview.document_id).toBe("doc-1");
    expect(preview.stored).toBe(true);
    expect(preview.download_url).toBe("https://storage.test/signed-receipt.pdf");
  });

  it("surfaces a receipt preview failure without starting a second PDF request", async () => {
    apiMocks.apiRequest.mockRejectedValue(new Error("storage preview unavailable"));

    await expect(businessApi.previewReceipt("payment-2")).rejects.toThrow(
      "storage preview unavailable",
    );
    expect(apiMocks.authenticatedFetch).not.toHaveBeenCalled();
  });

  it("does not let optional Documents data take down the Business workspace", async () => {
    apiMocks.apiRequest.mockRejectedValue(new Error("documents unavailable"));

    await expect(businessApi.documents()).resolves.toEqual([]);
    await expect(businessApi.projects()).resolves.toEqual([]);
  });
});
