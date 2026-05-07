import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { update: vi.fn() },
    auditLog: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth-utils", () => ({
  getCurrentUser: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth-utils";
import { revalidatePath } from "next/cache";
import { acceptTermsAction } from "@/lib/auth-actions";

const mockedGetCurrentUser = vi.mocked(getCurrentUser);
const mockedTransaction = vi.mocked(prisma.$transaction);
const mockedUserUpdate = vi.mocked(prisma.user.update);
const mockedAuditCreate = vi.mocked(prisma.auditLog.create);
const mockedRevalidate = vi.mocked(revalidatePath);

beforeEach(() => {
  vi.clearAllMocks();
  mockedTransaction.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return ops;
  });
});

describe("acceptTermsAction", () => {
  it("sets termsAcceptedAt and writes an audit log for an org user", async () => {
    mockedGetCurrentUser.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000001",
      email: "u@example.com",
      name: "U",
      role: "ORG_MEMBER",
      organizationId: "00000000-0000-0000-0000-0000000000aa",
      termsAcceptedAt: null,
    } as Awaited<ReturnType<typeof getCurrentUser>>);

    await acceptTermsAction();

    expect(mockedUserUpdate).toHaveBeenCalledTimes(1);
    expect(mockedUserUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "00000000-0000-0000-0000-000000000001" },
        data: expect.objectContaining({ termsAcceptedAt: expect.any(Date) }),
      }),
    );

    expect(mockedAuditCreate).toHaveBeenCalledTimes(1);
    expect(mockedAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: "00000000-0000-0000-0000-000000000001",
          organizationId: "00000000-0000-0000-0000-0000000000aa",
          action: "terms_accepted",
          resourceType: "User",
          resourceId: "00000000-0000-0000-0000-000000000001",
        }),
      }),
    );

    expect(mockedRevalidate).toHaveBeenCalledWith("/", "layout");
  });

  it("writes audit log with organizationId=null for ADMIN_KUBRI without org", async () => {
    mockedGetCurrentUser.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000002",
      email: "admin@kubri.it",
      name: "Admin",
      role: "ADMIN_KUBRI",
      organizationId: null,
      termsAcceptedAt: null,
    } as Awaited<ReturnType<typeof getCurrentUser>>);

    await acceptTermsAction();

    expect(mockedAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: null,
          action: "terms_accepted",
        }),
      }),
    );
  });

  it("is idempotent: does nothing if termsAcceptedAt is already set", async () => {
    mockedGetCurrentUser.mockResolvedValue({
      id: "00000000-0000-0000-0000-000000000003",
      email: "u@example.com",
      name: "U",
      role: "ORG_MEMBER",
      organizationId: "00000000-0000-0000-0000-0000000000bb",
      termsAcceptedAt: new Date("2026-05-01T10:00:00Z"),
    } as Awaited<ReturnType<typeof getCurrentUser>>);

    await acceptTermsAction();

    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(mockedAuditCreate).not.toHaveBeenCalled();
    expect(mockedRevalidate).not.toHaveBeenCalled();
  });

  it("propagates the error if getCurrentUser throws (unauthenticated)", async () => {
    mockedGetCurrentUser.mockRejectedValue(new Error("Non autenticato"));
    await expect(acceptTermsAction()).rejects.toThrow("Non autenticato");
    expect(mockedUserUpdate).not.toHaveBeenCalled();
    expect(mockedAuditCreate).not.toHaveBeenCalled();
  });
});
