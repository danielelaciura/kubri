import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: { candidate: { upsert: vi.fn() }, $executeRaw: vi.fn() } }));
vi.mock("@/lib/pools/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pools/resolve")>("@/lib/pools/resolve");
  return { ...actual, resolvePoolByExternalKey: vi.fn() };
});
vi.mock("@/lib/embeddings/client", () => ({ generateEmbedding: vi.fn(), vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]` }));

import { prisma } from "@/lib/db";
import { resolvePoolByExternalKey } from "@/lib/pools/resolve";
import { POST } from "@/app/api/webhooks/assessment/route";

const SECRET = "test-secret";
const POOL = { id: "00000000-0000-0000-0000-000000000001", name: "Global", externalKey: "global", createdAt: new Date() };

function req(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/webhooks/assessment", { method: "POST", headers, body: JSON.stringify(body) });
}

const VALID = {
  contact: {
    firstName: "Amir",
    lastName: "K",
    phone: "+393331234567",
    location: "Roma (RM)",
    latitude: 41.89,
    longitude: 12.48,
    privacyAccepted: true,
  },
  assessment: { q1: "analitico", q3: 4 },
};

describe("POST /api/webhooks/assessment", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = SECRET;
    process.env["ASSESSMENT_POOL_KEY"] = "global";
    (resolvePoolByExternalKey as ReturnType<typeof vi.fn>).mockResolvedValue(POOL);
    (prisma.candidate.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "c1", skillsAndCompetences: [], workExperience: [], educationAndTraining: [], desiredJob: null, jobConstraints: null,
    });
  });

  it("401 without secret", async () => {
    expect((await POST(req(VALID))).status).toBe(401);
  });

  it("400 on invalid payload", async () => {
    expect((await POST(req({ contact: {}, assessment: {} }, `Bearer ${SECRET}`))).status).toBe(400);
  });

  it("upserts with externalId = phone and assessmentProfile populated", async () => {
    const res = await POST(req(VALID, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const arg = (prisma.candidate.upsert as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(arg.create.externalId).toBe("+393331234567");
    expect(arg.create.email).toBeNull();
    expect(arg.create.channel).toBe("assessment");
    expect(arg.create.sharedWithGlobal).toBe(true);
    expect(arg.create.assessmentProfile).toMatchObject({ cognitive: { q1: "analitico" } });
    expect(arg.create.location).toBe("Roma (RM)");
    expect(arg.create.latitude).toBe(41.89);
    expect(arg.create.longitude).toBe(12.48);
  });
});
