import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-utils", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/landing/service", () => ({ saveLandingPage: vi.fn() }));

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { logAudit } from "@/lib/audit";
import { saveLandingPage } from "@/lib/landing/service";
import { saveLandingPageAction } from "@/lib/landing/admin-actions";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const POOL_ID = "11111111-1111-4111-8111-111111111111";
const IDLE = { status: "idle" as const };

function form(over: Record<string, string | null> = {}) {
  const base: Record<string, string | null> = {
    slug: "coop-sole",
    poolId: POOL_ID,
    privacyPolicyUrl: "https://x.it/privacy",
    enabled: "on",
    ...over,
  };
  const fd = new FormData();
  for (const [k, v] of Object.entries(base)) if (v !== null) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  m(getCurrentUser).mockResolvedValue({ id: "u-1", role: "ADMIN_KUBRI" });
  m(saveLandingPage).mockResolvedValue({ ok: true, id: "l-1" });
});

describe("saveLandingPageAction", () => {
  it("rejects non-admins without saving", async () => {
    m(getCurrentUser).mockResolvedValue({ id: "u-2", role: "ADMIN_CLIENTE" });
    expect(await saveLandingPageAction("o-1", IDLE, form())).toEqual({ status: "error", error: "FORBIDDEN" });
    expect(saveLandingPage).not.toHaveBeenCalled();
  });

  it("returns VALIDATION on invalid input", async () => {
    const r = await saveLandingPageAction("o-1", IDLE, form({ privacyPolicyUrl: "http://x.it" }));
    expect(r).toEqual({ status: "error", error: "VALIDATION" });
    expect(saveLandingPage).not.toHaveBeenCalled();
  });

  it("passes enabled=false when the checkbox is unchecked", async () => {
    await saveLandingPageAction("o-1", IDLE, form({ enabled: null }));
    expect(saveLandingPage).toHaveBeenCalledWith("o-1", expect.objectContaining({ enabled: false }));
  });

  it("passes SLUG_TAKEN through", async () => {
    m(saveLandingPage).mockResolvedValue({ ok: false, error: "SLUG_TAKEN" });
    expect(await saveLandingPageAction("o-1", IDLE, form())).toEqual({ status: "error", error: "SLUG_TAKEN" });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("audits, revalidates and returns saved on success", async () => {
    expect(await saveLandingPageAction("o-1", IDLE, form())).toEqual({ status: "saved" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "landing_page.save", organizationId: "o-1", resourceId: "l-1", userId: "u-1" }),
    );
    expect(revalidatePath).toHaveBeenCalledWith("/admin/organizations/o-1");
  });
});
