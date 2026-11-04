import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidateLandingPage: { findUnique: vi.fn(), upsert: vi.fn() },
    organizationPool: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { getActiveLandingBySlug, getLandingForOrg, saveLandingPage } from "@/lib/landing/service";
import { landingPageInputSchema } from "@/lib/validations/landing-page";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const POOL_ID = "11111111-1111-4111-8111-111111111111";
const ROW = {
  id: "l-1", slug: "coop-sole", enabled: true, privacyPolicyUrl: "https://x.it/privacy",
  titleIt: "Lavora con noi", titleEn: "Work with us", subtitleIt: "Due minuti.", subtitleEn: null,
  taglineIt: "Cooperativa sociale", taglineEn: null, logoPath: "landing-logos/o-1.png",
  updatedAt: new Date("2026-11-04T10:00:00Z"),
  organizationId: "o-1", poolId: POOL_ID,
  organization: { id: "o-1", name: "Coop Sole" },
  pool: { id: POOL_ID, isGlobal: false, globalSharing: "WEBHOOK", externalKey: "SOLE", slug: "sole" },
};

describe("landingPageInputSchema", () => {
  const ok = {
    slug: "Coop-Sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true,
    titleIt: " Lavora con noi ", titleEn: "Work with us", subtitleIt: "  ", subtitleEn: "Two minutes.",
    taglineIt: " Cooperativa sociale ", taglineEn: "",
  };
  it("lowercases the slug", () => {
    expect(landingPageInputSchema.parse(ok).slug).toBe("coop-sole");
  });
  it("trims the texts and turns a blank subtitle into none", () => {
    expect(landingPageInputSchema.parse(ok)).toMatchObject({
      titleIt: "Lavora con noi", titleEn: "Work with us", subtitleIt: null, subtitleEn: "Two minutes.",
      taglineIt: "Cooperativa sociale", taglineEn: null,
    });
  });
  it.each(["titleIt", "titleEn"])("requires %s", (key) => {
    expect(landingPageInputSchema.safeParse({ ...ok, [key]: "  " }).success).toBe(false);
  });
  it("caps title and subtitle length", () => {
    expect(landingPageInputSchema.safeParse({ ...ok, titleIt: "x".repeat(121) }).success).toBe(false);
    expect(landingPageInputSchema.safeParse({ ...ok, subtitleEn: "x".repeat(301) }).success).toBe(false);
  });
  it.each(["a", "-coop", "coop-", "coop sole", "coop_sole", "x".repeat(61)])("rejects slug %s", (slug) => {
    expect(landingPageInputSchema.safeParse({ ...ok, slug }).success).toBe(false);
  });
  it("requires an https privacy URL", () => {
    expect(landingPageInputSchema.safeParse({ ...ok, privacyPolicyUrl: "http://x.it" }).success).toBe(false);
  });
  it("accepts no organization privacy URL", () => {
    expect(landingPageInputSchema.parse({ ...ok, privacyPolicyUrl: "" }).privacyPolicyUrl).toBeNull();
  });
});

describe("getActiveLandingBySlug", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the landing when enabled, pool non-global and still linked", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    const l = await getActiveLandingBySlug("coop-sole");
    expect(l).toMatchObject({
      id: "l-1", organization: { name: "Coop Sole" }, pool: { id: POOL_ID },
      texts: {
        it: { title: "Lavora con noi", subtitle: "Due minuti.", tagline: "Cooperativa sociale" },
        en: { title: "Work with us", subtitle: null, tagline: null },
      },
      logoVersion: new Date("2026-11-04T10:00:00Z").getTime(),
    });
    expect(m(prisma.organizationPool.findUnique).mock.calls[0]![0].where).toEqual({
      organizationId_poolId: { organizationId: "o-1", poolId: POOL_ID },
    });
  });

  it("returns null when disabled", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce({ ...ROW, enabled: false });
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
    expect(m(prisma.organizationPool.findUnique)).not.toHaveBeenCalled();
  });

  it("returns a landing on the Global pool (internal Kubri organization)", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce({ ...ROW, pool: { ...ROW.pool, isGlobal: true } });
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toMatchObject({ pool: { isGlobal: true } });
  });

  it("returns null when the pool was detached from the organization", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce(null);
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
  });

  it("looks up by the lowercased slug", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    await getActiveLandingBySlug("Coop-Sole");
    expect(m(prisma.candidateLandingPage.findUnique).mock.calls[0]![0].where).toEqual({ slug: "coop-sole" });
  });

  it("returns null for an unknown slug", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(null);
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
    expect(m(prisma.organizationPool.findUnique)).not.toHaveBeenCalled();
  });

  it("does not query for an invalid slug", async () => {
    await expect(getActiveLandingBySlug("../etc")).resolves.toBeNull();
    expect(m(prisma.candidateLandingPage.findUnique)).not.toHaveBeenCalled();
  });
});

describe("saveLandingPage", () => {
  const input = {
    slug: "coop-sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true,
    titleIt: "Lavora con noi", titleEn: "Work with us", subtitleIt: null, subtitleEn: null,
    taglineIt: null, taglineEn: null,
  };
  beforeEach(() => vi.resetAllMocks());

  it("rejects a pool not linked to the organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce(null);
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "INVALID_POOL" });
    expect(m(prisma.candidateLandingPage.upsert)).not.toHaveBeenCalled();
  });

  it("accepts the Global pool when it is linked to the organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    m(prisma.candidateLandingPage.upsert).mockResolvedValueOnce({ id: "l-1" });
    await expect(saveLandingPage("o-1", input)).resolves.toMatchObject({ ok: true });
  });

  it("upserts by organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    m(prisma.candidateLandingPage.upsert).mockResolvedValueOnce({ id: "l-1" });
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: true, id: "l-1" });
    const args = m(prisma.candidateLandingPage.upsert).mock.calls[0]![0];
    expect(args.where).toEqual({ organizationId: "o-1" });
    expect(args.create).toEqual({ organizationId: "o-1", ...input, logoPath: null });
    expect(args.update).toEqual(input);
  });

  it.each([
    ["sets a new logo", "landing-logos/o-1.png"],
    ["clears the logo", null],
  ])("%s", async (_, logoPath) => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    m(prisma.candidateLandingPage.upsert).mockResolvedValueOnce({ id: "l-1" });
    await saveLandingPage("o-1", input, logoPath);
    const args = m(prisma.candidateLandingPage.upsert).mock.calls[0]![0];
    expect(args.update).toEqual({ ...input, logoPath });
  });

  it("maps a slug unique violation to SLUG_TAKEN", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    m(prisma.candidateLandingPage.upsert).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x", meta: { target: ["slug"] } }),
    );
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "SLUG_TAKEN" });
  });
});

describe("saveLandingPage errors", () => {
  it("rethrows non-P2002 errors", async () => {
    vi.resetAllMocks();
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    m(prisma.candidateLandingPage.upsert).mockRejectedValueOnce(new Error("boom"));
    await expect(
      saveLandingPage("o-1", {
        slug: "coop-sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true,
        titleIt: "Lavora con noi", titleEn: "Work with us", subtitleIt: null, subtitleEn: null,
    taglineIt: null, taglineEn: null,
      }),
    ).rejects.toThrow("boom");
  });
});

describe("getLandingForOrg", () => {
  beforeEach(() => vi.resetAllMocks());
  it("looks up by organization", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(null);
    await getLandingForOrg("o-1");
    expect(m(prisma.candidateLandingPage.findUnique).mock.calls.at(-1)![0].where).toEqual({ organizationId: "o-1" });
  });
});
