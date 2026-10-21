import { beforeEach, describe, expect, it } from "vitest";
import { clearSectionCaches, readSectionCache, writeSectionCache } from "./sectionCache";

const values = new Map<string, string>();

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    get length() {
      return values.size;
    },
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    clear: () => values.clear(),
  },
});

describe("sectionCache", () => {
  beforeEach(() => values.clear());

  it("stores and restores a section snapshot for the same user", () => {
    writeSectionCache("user-a", "projects", { count: 4 });
    expect(readSectionCache<{ count: number }>("user-a", "projects")?.data).toEqual({ count: 4 });
  });

  it("does not expose one user's cached section to another user", () => {
    writeSectionCache("user-a", "business", { receivables: 1200 });
    expect(readSectionCache("user-b", "business")).toBeNull();
  });

  it("clears Star Africa Logistics section snapshots without deleting unrelated browser data", () => {
    writeSectionCache("user-a", "tasks", { count: 2 });
    localStorage.setItem("unrelated.preference", "keep-me");
    clearSectionCaches();
    expect(readSectionCache("user-a", "tasks")).toBeNull();
    expect(localStorage.getItem("unrelated.preference")).toBe("keep-me");
  });
});
