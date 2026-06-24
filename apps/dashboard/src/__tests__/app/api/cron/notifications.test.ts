import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/notifications/select-recipients", () => ({
  getDueRecipients: vi.fn(),
}));
vi.mock("@/lib/notifications/new-candidates", () => ({
  getNewCandidatesForUser: vi.fn(),
}));
vi.mock("@/lib/notifications/send-digest", () => ({ sendDigest: vi.fn() }));

describe("GET /api/cron/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env["CRON_SECRET"] = "test-cron";
  });

  it("rejects unauthenticated calls", async () => {
    const { GET } = await import("@/app/api/cron/notifications/route");
    const res = await GET(new Request("http://x/api/cron/notifications"));
    expect(res.status).toBe(401);
  });

  it("sends to users with new candidates and skips empty ones", async () => {
    const { getDueRecipients } = await import("@/lib/notifications/select-recipients");
    const { getNewCandidatesForUser } = await import("@/lib/notifications/new-candidates");
    const { sendDigest } = await import("@/lib/notifications/send-digest");

    (getDueRecipients as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "u1", email: "a@b.c", organizationId: "o1", organizationName: "Coop", lastNotifiedAt: null, createdAt: new Date() },
      { id: "u2", email: "d@e.f", organizationId: "o2", organizationName: "Coop2", lastNotifiedAt: null, createdAt: new Date() },
    ]);
    (getNewCandidatesForUser as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ poolId: "p1", poolName: "Magazzino", count: 2 }])
      .mockResolvedValueOnce([]);

    const { GET } = await import("@/app/api/cron/notifications/route");
    const res = await GET(
      new Request("http://x/api/cron/notifications", {
        headers: { authorization: "Bearer test-cron" },
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sent: 1, skipped: 1, failed: 0 });
    expect(sendDigest).toHaveBeenCalledOnce();
  });
});
