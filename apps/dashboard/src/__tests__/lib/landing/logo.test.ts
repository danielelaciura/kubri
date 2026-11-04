import { describe, it, expect, vi } from "vitest";
import sharp from "sharp";

vi.mock("@/lib/storage/candidate-documents", () => ({
  replaceCandidateDocument: vi.fn(),
  removeCandidateDocuments: vi.fn(),
}));

import { LANDING_LOGO_MAX_BYTES, landingLogoPath, processLandingLogo } from "@/lib/landing/logo";

async function image(format: "png" | "jpeg", side: number) {
  const img = sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 128, b: 0, alpha: 0.5 } } });
  return new Uint8Array(await (format === "png" ? img.png() : img.jpeg()).toBuffer());
}

describe("processLandingLogo", () => {
  it("re-encodes a large PNG to a 256px PNG, keeping transparency", async () => {
    const r = await processLandingLogo(await image("png", 600));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const meta = await sharp(r.png).metadata();
    expect(meta).toMatchObject({ format: "png", width: 256, height: 256, hasAlpha: true });
  });

  it("accepts a JPEG", async () => {
    const r = await processLandingLogo(await image("jpeg", 100));
    expect(r.ok).toBe(true);
  });

  it("rejects anything that is not PNG or JPEG by its bytes", async () => {
    await expect(processLandingLogo(new TextEncoder().encode("%PDF-1.7"))).resolves.toEqual({ ok: false, error: "LOGO_UNSUPPORTED" });
  });

  it("rejects a file over the size cap", async () => {
    await expect(processLandingLogo(new Uint8Array(LANDING_LOGO_MAX_BYTES + 1)))
      .resolves.toEqual({ ok: false, error: "LOGO_TOO_LARGE" });
  });

  it("stores one logo per organization", () => {
    expect(landingLogoPath("o-1")).toBe("landing-logos/o-1.png");
  });
});
