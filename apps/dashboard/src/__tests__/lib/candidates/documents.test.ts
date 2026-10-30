import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { mapDocumentRows } from "@/lib/candidates/documents";

const base = { fileName: "cv.pdf", createdAt: new Date("2026-01-01") };

describe("mapDocumentRows", () => {
  it("flags landing documents and keeps operator uploads", () => {
    const rows = mapDocumentRows(
      [
        { ...base, id: "a", storagePath: "p/a", uploadedBy: null },
        { ...base, id: "b", storagePath: "p/b", uploadedBy: { name: "Mario" } },
        { ...base, id: "c", storagePath: "p/c", uploadedBy: null },
      ],
      new Set(["p/a"]),
    );
    expect(rows.map((r) => r.fromLanding)).toEqual([true, false, false]);
    expect(rows[1].uploadedByName).toBe("Mario");
    expect(rows[2].uploadedByName).toBeNull();
  });
});
