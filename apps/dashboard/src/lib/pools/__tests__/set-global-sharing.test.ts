import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: { pool: { findUnique: vi.fn(), update: vi.fn() } },
}));
vi.mock("@/lib/auth-utils", () => ({
  requireRole: vi.fn(async () => ({ id: "admin-1", role: "ADMIN_KUBRI" })),
}));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/i18n/locale", () => ({ getServerLocale: vi.fn(async () => "it") }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth-utils";
import { logAudit } from "@/lib/audit";
import { setPoolGlobalSharing } from "@/lib/pools/actions";

const findUnique = prisma.pool.findUnique as ReturnType<typeof vi.fn>;
const update = prisma.pool.update as ReturnType<typeof vi.fn>;

describe("setPoolGlobalSharing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires ADMIN_KUBRI", async () => {
    findUnique.mockResolvedValue({ isGlobal: false, globalSharing: "WEBHOOK" });
    await setPoolGlobalSharing("p1", "ALWAYS");
    expect(requireRole).toHaveBeenCalledWith("ADMIN_KUBRI");
  });

  it("updates the mode and audits from/to", async () => {
    findUnique.mockResolvedValue({ isGlobal: false, globalSharing: "WEBHOOK" });
    await setPoolGlobalSharing("p1", "NEVER");
    expect(update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { globalSharing: "NEVER" },
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "update_pool_global_sharing",
        resourceId: "p1",
        metadata: { from: "WEBHOOK", to: "NEVER" },
      }),
    );
  });

  it("is a no-op when the mode is unchanged", async () => {
    findUnique.mockResolvedValue({ isGlobal: false, globalSharing: "ALWAYS" });
    await setPoolGlobalSharing("p1", "ALWAYS");
    expect(update).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("rejects the Global pool", async () => {
    findUnique.mockResolvedValue({ isGlobal: true, globalSharing: "WEBHOOK" });
    await expect(setPoolGlobalSharing("g", "ALWAYS")).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects an unknown mode", async () => {
    await expect(setPoolGlobalSharing("p1", "SOMETIMES")).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a missing pool", async () => {
    findUnique.mockResolvedValue(null);
    await expect(setPoolGlobalSharing("nope", "NEVER")).rejects.toThrow();
  });
});
