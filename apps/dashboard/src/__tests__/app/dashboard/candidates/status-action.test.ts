import { describe, it, expect, vi, beforeEach } from "vitest";

const member = {
  id: "00000000-0000-0000-0000-0000000000a1",
  role: "ORG_MEMBER" as const,
  organizationId: "00000000-0000-0000-0000-0000000000b1",
};
const CAND = "3f1c2b7e-8a4d-4c6e-9b2a-1d5e7f9a0c3b";

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(async () => member),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/i18n/locale", () => ({
  getServerLocale: vi.fn(async () => "it"),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/pools/access", () => ({
  getOrgAccessiblePoolIds: vi.fn(async () => ["p1"]),
}));
vi.mock("@/lib/db", () => ({
  prisma: { candidate: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/candidates/status-service", () => ({
  changeCandidateStatus: vi.fn(async () => ({
    changed: true,
    from: "NEW",
    to: "OFFER",
  })),
}));

import { prisma } from "@/lib/db";
import { changeCandidateStatus } from "@/lib/candidates/status-service";
import { revalidatePath } from "next/cache";
import { setCandidateStatus } from "@/app/(dashboard)/dashboard/candidates/[id]/actions";

beforeEach(() => vi.clearAllMocks());

describe("setCandidateStatus", () => {
  it("rejects an unknown status", async () => {
    await expect(setCandidateStatus(CAND, "MAYBE")).rejects.toThrow();
    expect(changeCandidateStatus).not.toHaveBeenCalled();
  });

  it("rejects a candidate the org cannot see", async () => {
    vi.mocked(prisma.candidate.findFirst).mockResolvedValue(null);
    await expect(setCandidateStatus(CAND, "OFFER")).rejects.toThrow();
    expect(changeCandidateStatus).not.toHaveBeenCalled();
  });

  it("changes status for the user's own org and revalidates", async () => {
    vi.mocked(prisma.candidate.findFirst).mockResolvedValue({
      id: CAND,
    } as never);
    await setCandidateStatus(CAND, "OFFER");
    expect(changeCandidateStatus).toHaveBeenCalledWith({
      candidateId: CAND,
      organizationId: member.organizationId,
      userId: member.id,
      status: "OFFER",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/candidates");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/candidates/${CAND}`,
    );
  });
});
