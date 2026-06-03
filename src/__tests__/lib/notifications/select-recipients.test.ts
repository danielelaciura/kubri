import { describe, it, expect, vi, beforeEach } from "vitest";
import { isWeeklyDue } from "@/lib/notifications/select-recipients";

vi.mock("@/lib/db", () => ({
  prisma: { user: { findMany: vi.fn() } },
}));

describe("isWeeklyDue", () => {
  it("is due on Monday (WEEKLY_SEND_DAY=1)", () => {
    // 2026-06-01 is a Monday
    expect(isWeeklyDue(new Date("2026-06-01T07:00:00Z"))).toBe(true);
  });

  it("is not due on Tuesday", () => {
    expect(isWeeklyDue(new Date("2026-06-02T07:00:00Z"))).toBe(false);
  });
});

describe("getDueRecipients", () => {
  beforeEach(() => vi.clearAllMocks());

  it("maps users to recipients with org name", async () => {
    const { prisma } = await import("@/lib/db");
    (prisma.user.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "u1",
        email: "a@b.c",
        organizationId: "o1",
        lastNotifiedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
        organization: { name: "Coop Esempio" },
      },
    ]);
    const { getDueRecipients } = await import("@/lib/notifications/select-recipients");
    const res = await getDueRecipients(new Date("2026-06-01T07:00:00Z"));
    expect(res).toEqual([
      {
        id: "u1",
        email: "a@b.c",
        organizationId: "o1",
        organizationName: "Coop Esempio",
        lastNotifiedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
  });
});
