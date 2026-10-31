import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: { upsert: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn(),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { prisma } from "@/lib/db";
import { generateEmbedding } from "@/lib/embeddings/client";
import { buildCandidateEmbeddingText } from "@/lib/embeddings/text";
import {
  ingestCandidate,
  refreshCandidateEmbedding,
  upsertCandidate,
} from "@/lib/candidates/ingest";

const POOL_ID = "00000000-0000-0000-0000-000000000001";

const DATA = {
  poolId: POOL_ID,
  externalId: "ext-1",
  firstName: "Ahmed",
  workExperience: ["Magazziniere"],
  rawPayload: { source: "test" },
};

const ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  skillsAndCompetences: ["Muletto"],
  workExperience: ["Magazziniere"],
  educationAndTraining: [],
  desiredJob: "Magazziniere",
  jobConstraints: null,
};

const upsertMock = prisma.candidate.upsert as unknown as ReturnType<typeof vi.fn>;
const execMock = prisma.$executeRaw as unknown as ReturnType<typeof vi.fn>;
const embedMock = generateEmbedding as unknown as ReturnType<typeof vi.fn>;

describe("upsertCandidate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("upserts on (poolId, externalId) with the same data for create and update", async () => {
    upsertMock.mockResolvedValueOnce(ROW);
    const row = await upsertCandidate(DATA);
    expect(row).toEqual(ROW);
    const arg = upsertMock.mock.calls[0]![0];
    expect(arg.where).toEqual({
      poolId_externalId: { poolId: POOL_ID, externalId: "ext-1" },
    });
    expect(arg.create).toEqual(DATA);
    expect(arg.update).toEqual(DATA);
    expect(arg.select).toMatchObject({ id: true, workExperience: true });
  });

  it("uses the transaction client when given one", async () => {
    const txUpsert = vi.fn().mockResolvedValueOnce(ROW);
    const tx = { candidate: { upsert: txUpsert } };
    await upsertCandidate(DATA, tx as never);
    expect(txUpsert).toHaveBeenCalledTimes(1);
    expect(upsertMock).not.toHaveBeenCalled();
  });
});

describe("refreshCandidateEmbedding", () => {
  beforeEach(() => vi.resetAllMocks());

  it("writes the embedding when there is text", async () => {
    embedMock.mockResolvedValueOnce([0.1, 0.2]);
    execMock.mockResolvedValueOnce(1);
    await refreshCandidateEmbedding(ROW, "test");
    expect(embedMock).toHaveBeenCalledTimes(1);
    expect(execMock).toHaveBeenCalledTimes(1);
    const expectedText = buildCandidateEmbeddingText({
      skillsAndCompetences: ROW.skillsAndCompetences,
      workExperience: ROW.workExperience,
      educationAndTraining: ROW.educationAndTraining,
      desiredJob: ROW.desiredJob,
      jobConstraints: ROW.jobConstraints,
    });
    expect(execMock.mock.calls[0]!.slice(1)).toEqual([
      "[0.1,0.2]",
      expectedText,
      ROW.id,
    ]);
  });

  it("skips when the embedding text is empty", async () => {
    await refreshCandidateEmbedding(
      { ...ROW, skillsAndCompetences: [], workExperience: [], desiredJob: null },
      "test",
    );
    expect(embedMock).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
  });

  it("logs and swallows a failed DB write", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    embedMock.mockResolvedValueOnce([0.1]);
    execMock.mockRejectedValueOnce(new Error("db write"));
    await expect(refreshCandidateEmbedding(ROW, "t")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      "[t] embedding failed",
      expect.objectContaining({ candidateId: ROW.id }),
    );
    err.mockRestore();
  });

  it("logs and swallows embedding failures", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    embedMock.mockRejectedValueOnce(new Error("edge down"));
    await expect(refreshCandidateEmbedding(ROW, "my-tag")).resolves.toBeUndefined();
    expect(err).toHaveBeenCalledWith(
      "[my-tag] embedding failed",
      expect.objectContaining({ candidateId: ROW.id }),
    );
    err.mockRestore();
  });
});

describe("ingestCandidate", () => {
  beforeEach(() => vi.resetAllMocks());

  it("upserts then refreshes the embedding and returns the id", async () => {
    upsertMock.mockResolvedValueOnce(ROW);
    embedMock.mockResolvedValueOnce([0.1]);
    execMock.mockResolvedValueOnce(1);
    const res = await ingestCandidate(DATA, "test");
    expect(res).toEqual({ candidateId: ROW.id });
    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it("propagates upsert failures", async () => {
    upsertMock.mockRejectedValueOnce(new Error("db down"));
    await expect(ingestCandidate(DATA, "test")).rejects.toThrow("db down");
  });
});
