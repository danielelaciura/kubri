import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/email/client", () => ({
  resend: { emails: { send: vi.fn().mockResolvedValue({ data: { id: "x" }, error: null }) } },
  EMAIL_FROM: "Kubri <test@resend.dev>",
}));
vi.mock("@/lib/db", () => ({
  prisma: { user: { update: vi.fn().mockResolvedValue({}) } },
}));

describe("sendDigest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends one email and updates lastNotifiedAt", async () => {
    const { sendDigest } = await import("@/lib/notifications/send-digest");
    const { resend } = await import("@/lib/email/client");
    const { prisma } = await import("@/lib/db");

    await sendDigest({ id: "u1", email: "a@b.c" }, "Coop", [
      { poolId: "p1", poolName: "Magazzino", count: 2 },
    ]);

    expect(resend.emails.send).toHaveBeenCalledOnce();
    const arg = (resend.emails.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.to).toBe("a@b.c");
    expect(arg.from).toBe("Kubri <test@resend.dev>");
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { lastNotifiedAt: expect.any(Date) },
    });
  });
});
