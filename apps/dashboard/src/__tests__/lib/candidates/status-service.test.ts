import { describe, it, expect, vi, beforeEach } from "vitest";

const tx = {
  candidateStatus: { findUnique: vi.fn(), upsert: vi.fn() },
  auditLog: { create: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    candidateStatus: { findMany: vi.fn(), findUnique: vi.fn() },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}));

import { prisma } from "@/lib/db";
import {
  changeCandidateStatus,
  getCandidateStatusForOrg,
  getStatusByCandidateForOrg,
} from "@/lib/candidates/status-service";

const ORG = "00000000-0000-0000-0000-0000000000b1";
const USER = "00000000-0000-0000-0000-0000000000a1";
const CAND = "00000000-0000-0000-0000-0000000000c1";

beforeEach(() => vi.clearAllMocks());

describe("status-service", () => {
  it("getStatusByCandidateForOrg scopes by org and builds a map", async () => {
    vi.mocked(prisma.candidateStatus.findMany).mockResolvedValue([
      { candidateId: "c1", status: "OFFER" },
    ] as never);
    await expect(getStatusByCandidateForOrg(ORG)).resolves.toEqual({
      c1: "OFFER",
    });
    expect(prisma.candidateStatus.findMany).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      select: { candidateId: true, status: true },
    });
  });

  it("getCandidateStatusForOrg defaults to NEW", async () => {
    vi.mocked(prisma.candidateStatus.findUnique).mockResolvedValue(null);
    await expect(getCandidateStatusForOrg(ORG, CAND)).resolves.toBe("NEW");
  });

  it("changeCandidateStatus upserts and audits a real change", async () => {
    tx.candidateStatus.findUnique.mockResolvedValue(null);
    const res = await changeCandidateStatus({
      candidateId: CAND,
      organizationId: ORG,
      userId: USER,
      status: "SCREENING",
    });
    expect(res).toEqual({ changed: true, from: "NEW", to: "SCREENING" });
    expect(tx.candidateStatus.upsert).toHaveBeenCalledWith({
      where: {
        candidateId_organizationId: { candidateId: CAND, organizationId: ORG },
      },
      create: {
        candidateId: CAND,
        organizationId: ORG,
        status: "SCREENING",
        updatedByUserId: USER,
      },
      update: { status: "SCREENING", updatedByUserId: USER },
    });
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        userId: USER,
        organizationId: ORG,
        action: "candidate.status.change",
        resourceType: "candidate",
        resourceId: CAND,
        metadata: { from: "NEW", to: "SCREENING" },
      },
    });
  });

  it("changeCandidateStatus is a no-op when the status is unchanged", async () => {
    tx.candidateStatus.findUnique.mockResolvedValue({ status: "OFFER" });
    const res = await changeCandidateStatus({
      candidateId: CAND,
      organizationId: ORG,
      userId: USER,
      status: "OFFER",
    });
    expect(res).toEqual({ changed: false, from: "OFFER", to: "OFFER" });
    expect(tx.candidateStatus.upsert).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
  });
});
