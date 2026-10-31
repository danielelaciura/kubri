import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { candidate: { findMany: vi.fn() } } }));

import { prisma } from "@/lib/db";
import { findPossibleDuplicates, phoneSuffix } from "@/lib/candidates/duplicates";

const findMany = prisma.candidate.findMany as unknown as ReturnType<typeof vi.fn>;

describe("phoneSuffix", () => {
  it("keeps the last 8 digits", () => {
    expect(phoneSuffix("+39 345 123 4567")).toBe("51234567");
  });
  it("returns null for short or missing numbers", () => {
    expect(phoneSuffix("12345")).toBeNull();
    expect(phoneSuffix(null)).toBeNull();
  });
});

describe("findPossibleDuplicates", () => {
  beforeEach(() => vi.resetAllMocks());

  it("skips the query when there is nothing to match", async () => {
    await expect(findPossibleDuplicates("p", { phone: null, email: null })).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("matches by phone suffix or email inside the pool", async () => {
    findMany.mockResolvedValueOnce([{ id: "c1", firstName: "A", lastName: "B" }]);
    const r = await findPossibleDuplicates("p", { phone: "+39 345 1234567", email: "a@b.it" });
    expect(r).toEqual([{ id: "c1", firstName: "A", lastName: "B" }]);
    expect(findMany.mock.calls[0]![0].where).toEqual({
      poolId: "p",
      OR: [
        { phone: { endsWith: "51234567" } },
        { email: { equals: "a@b.it", mode: "insensitive" } },
      ],
    });
  });
});
