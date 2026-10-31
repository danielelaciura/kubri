import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/origin", () => ({ getAppOrigin: vi.fn(async () => "https://req.example") }));

import { landingPublicUrl } from "@/lib/landing/url";

describe("landingPublicUrl", () => {
  const prev = process.env["NEXT_PUBLIC_APP_URL"];
  beforeEach(() => {
    delete process.env["NEXT_PUBLIC_APP_URL"];
  });
  afterEach(() => {
    if (prev === undefined) delete process.env["NEXT_PUBLIC_APP_URL"];
    else process.env["NEXT_PUBLIC_APP_URL"] = prev;
  });

  it("uses NEXT_PUBLIC_APP_URL and strips trailing slashes", async () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "https://app.kubri.it//";
    expect(await landingPublicUrl("coop")).toBe("https://app.kubri.it/candidati/coop");
  });
  it("falls back to the request origin when unset or blank", async () => {
    expect(await landingPublicUrl("coop")).toBe("https://req.example/candidati/coop");
    process.env["NEXT_PUBLIC_APP_URL"] = "  ";
    expect(await landingPublicUrl("coop")).toBe("https://req.example/candidati/coop");
  });
});
