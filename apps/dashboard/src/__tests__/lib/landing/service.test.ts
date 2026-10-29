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
  organizationId: "o-1", poolId: POOL_ID,
  organization: { id: "o-1", name: "Coop Sole" },
  pool: { id: POOL_ID, isGlobal: false, globalSharing: "WEBHOOK", externalKey: "SOLE", slug: "sole" },
};

describe("landingPageInputSchema", () => {
  const ok = { slug: "Coop-Sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true };
  it("lowercases the slug", () => {
    expect(landingPageInputSchema.parse(ok).slug).toBe("coop-sole");
  });
  it.each(["a", "-coop", "coop-", "coop sole", "coop_sole", "x".repeat(61)])("rejects slug %s", (slug) => {
    expect(landingPageInputSchema.safeParse({ ...ok, slug }).success).toBe(false);
  });
  it("requires an https privacy URL", () => {
    expect(landingPageInputSchema.safeParse({ ...ok, privacyPolicyUrl: "http://x.it" }).success).toBe(false);
  });
});

describe("getActiveLandingBySlug", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the landing when enabled, pool non-global and still linked", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    const l = await getActiveLandingBySlug("coop-sole");
    expect(l).toMatchObject({ id: "l-1", organization: { name: "Coop Sole" }, pool: { id: POOL_ID } });
    expect(m(prisma.organizationPool.findUnique).mock.calls[0]![0].where).toEqual({
      organizationId_poolId: { organizationId: "o-1", poolId: POOL_ID },
    });
  });

  it.each([
    ["disabled", { ...ROW, enabled: false }],
    ["global pool", { ...ROW, pool: { ...ROW.pool, isGlobal: true } }],
  ])("returns null when %s", async (_, row) => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(row);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ poolId: POOL_ID });
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
  });

  it("returns null when the pool was detached from the organization", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(ROW);
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce(null);
    await expect(getActiveLandingBySlug("coop-sole")).resolves.toBeNull();
  });

  it("does not query for an invalid slug", async () => {
    await expect(getActiveLandingBySlug("../etc")).resolves.toBeNull();
    expect(m(prisma.candidateLandingPage.findUnique)).not.toHaveBeenCalled();
  });
});

describe("saveLandingPage", () => {
  const input = { slug: "coop-sole", poolId: POOL_ID, privacyPolicyUrl: "https://x.it/p", enabled: true };
  beforeEach(() => vi.resetAllMocks());

  it("rejects a pool not linked to the organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce(null);
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "INVALID_POOL" });
    expect(m(prisma.candidateLandingPage.upsert)).not.toHaveBeenCalled();
  });

  it("rejects a global pool", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ pool: { isGlobal: true } });
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "INVALID_POOL" });
  });

  it("upserts by organization", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ pool: { isGlobal: false } });
    m(prisma.candidateLandingPage.upsert).mockResolvedValueOnce({ id: "l-1" });
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: true, id: "l-1" });
    const args = m(prisma.candidateLandingPage.upsert).mock.calls[0]![0];
    expect(args.where).toEqual({ organizationId: "o-1" });
    expect(args.create).toEqual({ organizationId: "o-1", ...input });
    expect(args.update).toEqual(input);
  });

  it("maps a slug unique violation to SLUG_TAKEN", async () => {
    m(prisma.organizationPool.findUnique).mockResolvedValueOnce({ pool: { isGlobal: false } });
    m(prisma.candidateLandingPage.upsert).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x", meta: { target: ["slug"] } }),
    );
    await expect(saveLandingPage("o-1", input)).resolves.toEqual({ ok: false, error: "SLUG_TAKEN" });
  });
});

describe("getLandingForOrg", () => {
  it("looks up by organization", async () => {
    m(prisma.candidateLandingPage.findUnique).mockResolvedValueOnce(null);
    await getLandingForOrg("o-1");
    expect(m(prisma.candidateLandingPage.findUnique).mock.calls.at(-1)![0].where).toEqual({ organizationId: "o-1" });
  });
});
