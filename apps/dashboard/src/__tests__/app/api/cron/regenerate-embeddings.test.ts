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
});
