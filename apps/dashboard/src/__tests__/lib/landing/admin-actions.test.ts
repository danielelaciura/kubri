import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth-utils", () => ({ getCurrentUser: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/landing/service", () => ({ saveLandingPage: vi.fn() }));
vi.mock("@/lib/landing/logo", () => ({
  processLandingLogo: vi.fn(),
  storeLandingLogo: vi.fn(),
  removeLandingLogo: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth-utils";
import { logAudit } from "@/lib/audit";
import { saveLandingPage } from "@/lib/landing/service";
import { saveLandingPageAction } from "@/lib/landing/admin-actions";
import { processLandingLogo, removeLandingLogo, storeLandingLogo } from "@/lib/landing/logo";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const POOL_ID = "11111111-1111-4111-8111-111111111111";
const ORG_ID = "22222222-2222-4222-8222-222222222222";
const IDLE = { status: "idle" as const };

function form(over: Record<string, string | Blob | null> = {}) {
  const base: Record<string, string | Blob | null> = {
    slug: "coop-sole",
    poolId: POOL_ID,
    privacyPolicyUrl: "https://x.it/privacy",
    enabled: "on",
    titleIt: "Lavora con noi",
    titleEn: "Work with us",
    subtitleIt: "",
    subtitleEn: "Two minutes.",
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
    expect(await saveLandingPageAction(ORG_ID, IDLE, form())).toEqual({ status: "error", error: "FORBIDDEN" });
    expect(saveLandingPage).not.toHaveBeenCalled();
  });

  it("returns VALIDATION on invalid input", async () => {
    const r = await saveLandingPageAction(ORG_ID, IDLE, form({ privacyPolicyUrl: "http://x.it" }));
    expect(r).toEqual({ status: "error", error: "VALIDATION" });
    expect(saveLandingPage).not.toHaveBeenCalled();
  });

  it("returns VALIDATION when the organization id is not a UUID", async () => {
    expect(await saveLandingPageAction("not-a-uuid", IDLE, form())).toEqual({ status: "error", error: "VALIDATION" });
    expect(saveLandingPage).not.toHaveBeenCalled();
  });

  it("passes the page texts, a blank subtitle as none", async () => {
    await saveLandingPageAction(ORG_ID, IDLE, form());
    expect(saveLandingPage).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({
      titleIt: "Lavora con noi", titleEn: "Work with us", subtitleIt: null, subtitleEn: "Two minutes.",
    }), undefined);
  });

  it("returns VALIDATION without a title", async () => {
    expect(await saveLandingPageAction(ORG_ID, IDLE, form({ titleEn: "" }))).toEqual({ status: "error", error: "VALIDATION" });
  });

  it("leaves the logo unchanged without a file or the remove checkbox", async () => {
    await saveLandingPageAction(ORG_ID, IDLE, form());
    expect(m(saveLandingPage).mock.calls[0]![2]).toBeUndefined();
    expect(processLandingLogo).not.toHaveBeenCalled();
  });

  it("stores a new logo and saves its path", async () => {
    m(processLandingLogo).mockResolvedValueOnce({ ok: true, png: new Uint8Array([1]) });
    m(storeLandingLogo).mockResolvedValueOnce(`landing-logos/${ORG_ID}.png`);
    const logo = new File([new Uint8Array([0x89, 0x50])], "logo.png", { type: "image/png" });
    expect(await saveLandingPageAction(ORG_ID, IDLE, form({ logo }))).toEqual({ status: "saved" });
    expect(storeLandingLogo).toHaveBeenCalledWith(ORG_ID, new Uint8Array([1]));
    expect(m(saveLandingPage).mock.calls[0]![2]).toBe(`landing-logos/${ORG_ID}.png`);
  });

  it("rejects an unusable logo without saving", async () => {
    m(processLandingLogo).mockResolvedValueOnce({ ok: false, error: "LOGO_UNSUPPORTED" });
    const logo = new File(["gif"], "logo.gif", { type: "image/gif" });
    expect(await saveLandingPageAction(ORG_ID, IDLE, form({ logo }))).toEqual({ status: "error", error: "LOGO_UNSUPPORTED" });
    expect(saveLandingPage).not.toHaveBeenCalled();
  });

  it("clears the logo and removes the file when asked", async () => {
    m(removeLandingLogo).mockResolvedValueOnce(undefined);
    await saveLandingPageAction(ORG_ID, IDLE, form({ removeLogo: "on" }));
    expect(m(saveLandingPage).mock.calls[0]![2]).toBeNull();
    expect(removeLandingLogo).toHaveBeenCalledWith(ORG_ID);
  });

  it("passes enabled=false when the checkbox is unchecked", async () => {
    await saveLandingPageAction(ORG_ID, IDLE, form({ enabled: null }));
    expect(saveLandingPage).toHaveBeenCalledWith(ORG_ID, expect.objectContaining({ enabled: false }), undefined);
  });

  it("passes SLUG_TAKEN through", async () => {
    m(saveLandingPage).mockResolvedValue({ ok: false, error: "SLUG_TAKEN" });
    expect(await saveLandingPageAction(ORG_ID, IDLE, form())).toEqual({ status: "error", error: "SLUG_TAKEN" });
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("audits, revalidates and returns saved on success", async () => {
    expect(await saveLandingPageAction(ORG_ID, IDLE, form())).toEqual({ status: "saved" });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "landing_page.save", organizationId: ORG_ID, resourceId: "l-1", userId: "u-1" }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/admin/organizations/${ORG_ID}`);
  });
});
