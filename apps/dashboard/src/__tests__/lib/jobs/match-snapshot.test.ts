import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobMatch: {
      deleteMany: vi.fn((args: unknown) => ({ op: "deleteMany", args })),
      createMany: vi.fn((args: unknown) => ({ op: "createMany", args })),
    },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { replaceJobMatchSnapshot } from "@/lib/jobs/match-snapshot";

beforeEach(() => vi.clearAllMocks());

describe("replaceJobMatchSnapshot", () => {
  it("deletes the JD rows and inserts the new entries in one transaction", async () => {
    await replaceJobMatchSnapshot({
      jobDescriptionId: "jd-1",
      organizationId: "org-1",
      entries: [
        { candidateId: "c1", llmScore: 91 },
        { candidateId: "c2", llmScore: 64 },
      ],
    });

    expect(mockPrisma.jobMatch.deleteMany).toHaveBeenCalledWith({
      where: { jobDescriptionId: "jd-1", organizationId: "org-1" },
    });
    expect(mockPrisma.jobMatch.createMany).toHaveBeenCalledWith({
      data: [
        { jobDescriptionId: "jd-1", organizationId: "org-1", candidateId: "c1", llmScore: 91 },
        { jobDescriptionId: "jd-1", organizationId: "org-1", candidateId: "c2", llmScore: 64 },
      ],
    });
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    const ops = mockPrisma.$transaction.mock.calls[0]![0] as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["deleteMany", "createMany"]);
  });

  it("only deletes when there are no entries", async () => {
    await replaceJobMatchSnapshot({ jobDescriptionId: "jd-1", organizationId: "org-1", entries: [] });
    expect(mockPrisma.jobMatch.createMany).not.toHaveBeenCalled();
    const ops = mockPrisma.$transaction.mock.calls[0]![0] as Array<{ op: string }>;
    expect(ops.map((o) => o.op)).toEqual(["deleteMany"]);
  });
});
