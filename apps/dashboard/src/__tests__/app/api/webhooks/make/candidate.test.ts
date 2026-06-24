import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: {
      upsert: vi.fn(),
    },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/pools/resolve", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/pools/resolve")>(
      "@/lib/pools/resolve",
    );
  return {
    ...actual,
    resolvePoolByExternalKey: vi.fn(),
  };
});

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn(),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

import { prisma } from "@/lib/db";
import {
  resolvePoolByExternalKey,
  UnknownPoolError,
} from "@/lib/pools/resolve";
import { generateEmbedding } from "@/lib/embeddings/client";
import { POST } from "@/app/api/webhooks/make/candidate/route";

const SECRET = "test-secret-xyz";

const POOL = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Global",
  externalKey: "global",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};

function makeRequest(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/webhooks/make/candidate", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/webhooks/make/candidate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["MAKE_WEBHOOK_SECRET"] = SECRET;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(
      makeRequest({ key: "k", externalKey: "global", data: {} }),
    );
    expect(res.status).toBe(401);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization secret is wrong", async () => {
    const res = await POST(
      makeRequest(
        { key: "k", externalKey: "global", data: {} },
        "Bearer wrong",
      ),
    );
    expect(res.status).toBe(401);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(makeRequest("{not json", `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when schema validation fails (missing key)", async () => {
    const res = await POST(
      makeRequest(
        { externalKey: "global", data: {} },
        `Bearer ${SECRET}`,
      ),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation_failed");
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when externalKey is missing", async () => {
    const res = await POST(
      makeRequest({ key: "k", data: {} }, `Bearer ${SECRET}`),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation_failed");
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 422 when externalKey does not match any pool", async () => {
    vi.mocked(resolvePoolByExternalKey).mockRejectedValue(
      new UnknownPoolError("nope"),
    );

    const res = await POST(
      makeRequest(
        { key: "k", externalKey: "nope", data: {} },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("unknown_pool");
    expect(json.externalKey).toBe("nope");
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 200 and upserts on happy path", async () => {
    vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
    vi.mocked(prisma.candidate.upsert).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      skillsAndCompetences: ["sala"],
      workExperience: ["cameriere 2 anni"],
      educationAndTraining: [],
      desiredJob: "cameriere",
      jobConstraints: null,
    } as never);
    vi.mocked(generateEmbedding).mockResolvedValue(
      Array.from({ length: 384 }, () => 0.1),
    );
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);

    const res = await POST(
      makeRequest(
        {
          key: "ext_123",
          externalKey: "global",
          data: { first_name: "Mario", interview_complete: true },
        },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.candidateId).toBe("11111111-1111-1111-1111-111111111111");

    expect(prisma.candidate.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.candidate.upsert).mock.calls[0]![0];
    expect(arg.where).toEqual({
      poolId_externalId: {
        poolId: POOL.id,
        externalId: "ext_123",
      },
    });
    expect(arg.create.firstName).toBe("Mario");
    expect(arg.create.poolId).toBe(POOL.id);
    expect(arg.update.firstName).toBe("Mario");
  });

  it("generates and stores the embedding after upsert", async () => {
    vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
    vi.mocked(prisma.candidate.upsert).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      skillsAndCompetences: ["sala", "haccp"],
      workExperience: ["pizzeria"],
      educationAndTraining: [],
      desiredJob: "cameriere",
      jobConstraints: null,
    } as never);
    vi.mocked(generateEmbedding).mockResolvedValue(
      Array.from({ length: 384 }, () => 0.1),
    );
    vi.mocked(prisma.$executeRaw).mockResolvedValue(1 as never);

    const res = await POST(
      makeRequest(
        { key: "k", externalKey: "global", data: { first_name: "Mario", interview_complete: true } },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(generateEmbedding).toHaveBeenCalledTimes(1);
    const text = vi.mocked(generateEmbedding).mock.calls[0]![0];
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("sala");
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
  });

  it("returns 200 even if embedding generation fails", async () => {
    vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
    vi.mocked(prisma.candidate.upsert).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      skillsAndCompetences: ["sala"],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    } as never);
    vi.mocked(generateEmbedding).mockRejectedValue(new Error("edge down"));

    const res = await POST(
      makeRequest(
        { key: "k", externalKey: "global", data: { first_name: "Mario", interview_complete: true } },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("skips embedding when text is empty", async () => {
    vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
    vi.mocked(prisma.candidate.upsert).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      skillsAndCompetences: [],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    } as never);

    const res = await POST(
      makeRequest(
        { key: "k", externalKey: "global", data: { first_name: "Mario", interview_complete: true } },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(200);
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });

  it("returns 500 when prisma throws", async () => {
    vi.mocked(resolvePoolByExternalKey).mockResolvedValue(POOL as never);
    vi.mocked(prisma.candidate.upsert).mockRejectedValue(new Error("db down"));

    const res = await POST(
      makeRequest(
        { key: "k", externalKey: "global", data: {} },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("internal_error");
  });
});
