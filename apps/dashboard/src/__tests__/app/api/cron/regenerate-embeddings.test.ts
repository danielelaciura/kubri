import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn().mockResolvedValue(Array.from({ length: 384 }, () => 0.1)),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    $queryRaw: vi.fn().mockResolvedValue([]),
    $executeRaw: vi.fn().mockResolvedValue(1),
  },
}));

vi.mock("@/lib/candidate-imports/service", () => ({
  discardStaleImports: vi.fn().mockResolvedValue(0),
  removeOrphanUploads: vi.fn().mockResolvedValue(3),
}));

describe("GET /api/cron/regenerate-embeddings", () => {
  beforeEach(() => {
    process.env["CRON_SECRET"] = "test-cron";
  });

  it("rejects unauthenticated calls", async () => {
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    const res = await GET(new Request("http://x/api/cron/regenerate-embeddings"));
    expect(res.status).toBe(401);
  });

  it("processes candidates and jobs with null embeddings", async () => {
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    const req = new Request("http://x/api/cron/regenerate-embeddings", {
      headers: { authorization: "Bearer test-cron" },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("candidates");
    expect(body).toHaveProperty("jobs");
  });

  it("removes orphan uploads and reports the count", async () => {
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    const res = await GET(new Request("http://x/api/cron/regenerate-embeddings", {
      headers: { authorization: "Bearer test-cron" },
    }));
    expect(await res.json()).toMatchObject({ discardedImports: 0, removedOrphanUploads: 3 });
  });

  it("a failing orphan cleanup does not fail the cron", async () => {
    const service = await import("@/lib/candidate-imports/service");
    vi.mocked(service.removeOrphanUploads).mockRejectedValueOnce(new Error("storage down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    const res = await GET(new Request("http://x/api/cron/regenerate-embeddings", {
      headers: { authorization: "Bearer test-cron" },
    }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ removedOrphanUploads: 0 });
  });

  it("runs the orphan sweep after the embedding work", async () => {
    const service = await import("@/lib/candidate-imports/service");
    const { prisma } = await import("@/lib/db");
    vi.mocked(service.removeOrphanUploads).mockClear();
    vi.mocked(prisma.$queryRaw).mockClear();
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    await GET(new Request("http://x/api/cron/regenerate-embeddings", {
      headers: { authorization: "Bearer test-cron" },
    }));
    const sweep = vi.mocked(service.removeOrphanUploads).mock.invocationCallOrder[0]!;
    const queries = vi.mocked(prisma.$queryRaw).mock.invocationCallOrder;
    expect(queries.length).toBe(2);
    expect(sweep).toBeGreaterThan(Math.max(...queries));
  });

  it("logs only the error name and message when the stale import cleanup fails", async () => {
    const service = await import("@/lib/candidate-imports/service");
    const err = Object.assign(new Error("db down"), { meta: "p/i/CV_Ahmed.pdf" });
    vi.mocked(service.discardStaleImports).mockRejectedValueOnce(err);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/cron/regenerate-embeddings/route");
    await GET(new Request("http://x/api/cron/regenerate-embeddings", {
      headers: { authorization: "Bearer test-cron" },
    }));
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("db down");
    expect(logged).not.toContain("CV_Ahmed");
    spy.mockRestore();
  });
});
