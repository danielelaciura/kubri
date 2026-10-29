import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  _resetSecretWarningForTests,
  hashIp,
  landingCookieOptions,
  LANDING_COOKIE_TTL_SEC,
  signImportCookie,
  verifyImportCookie,
} from "@/lib/landing/import-cookie";

const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const LANDING_ID = "33333333-3333-4333-8333-333333333333";
const NOW = 1_800_000_000_000;

describe("import cookie", () => {
  beforeEach(() => vi.stubEnv("LANDING_COOKIE_SECRET", "s".repeat(32)));
  afterEach(() => vi.unstubAllEnvs());

  it("round-trips import and landing ids", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    expect(verifyImportCookie(v, NOW + 1000)).toEqual({ importId: IMPORT_ID, landingId: LANDING_ID });
  });

  it("rejects an expired cookie", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    expect(verifyImportCookie(v, NOW + (LANDING_COOKIE_TTL_SEC + 1) * 1000)).toBeNull();
  });

  it("rejects a tampered import id or signature", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    const other = "44444444-4444-4444-8444-444444444444";
    expect(verifyImportCookie(v.replace(IMPORT_ID, other), NOW)).toBeNull();
    expect(verifyImportCookie(`${v.slice(0, -2)}xx`, NOW)).toBeNull();
  });

  it("rejects garbage and missing values", () => {
    expect(verifyImportCookie(undefined, NOW)).toBeNull();
    expect(verifyImportCookie("a.b.c", NOW)).toBeNull();
    expect(verifyImportCookie("not-a-uuid.x.1.sig", NOW)).toBeNull();
  });

  it("rejects a cookie signed with another secret", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    vi.stubEnv("LANDING_COOKIE_SECRET", "t".repeat(32));
    expect(verifyImportCookie(v, NOW)).toBeNull();
  });

  it("returns null (and logs once, no values) when the secret is missing", () => {
    const v = signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW);
    _resetSecretWarningForTests();
    vi.stubEnv("LANDING_COOKIE_SECRET", "");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(verifyImportCookie(v, NOW)).toBeNull();
    expect(spy).toHaveBeenCalledWith("[landing] LANDING_COOKIE_SECRET missing or too short");
    spy.mockRestore();
  });

  it("refuses to sign with a missing or short secret", () => {
    vi.stubEnv("LANDING_COOKIE_SECRET", "short");
    expect(() => signImportCookie({ importId: IMPORT_ID, landingId: LANDING_ID }, NOW)).toThrow();
  });
});

describe("hashIp", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is stable, salted and never contains the IP", () => {
    vi.stubEnv("LANDING_IP_SALT", "salt-a");
    const a = hashIp("1.2.3.4");
    expect(a).toBe(hashIp("1.2.3.4"));
    expect(a).not.toContain("1.2.3.4");
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    vi.stubEnv("LANDING_IP_SALT", "salt-b");
    expect(hashIp("1.2.3.4")).not.toBe(a);
  });

  it("treats empty and null IP alike", () => {
    vi.stubEnv("LANDING_IP_SALT", "salt-a");
    expect(hashIp("")).toBe(hashIp(null));
  });

  it("requires a 16+ char salt in production, falls back in dev", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANDING_IP_SALT", "");
    expect(() => hashIp("1.2.3.4")).toThrow();
    vi.stubEnv("LANDING_IP_SALT", "short");
    expect(() => hashIp("1.2.3.4")).toThrow();
    vi.stubEnv("NODE_ENV", "development");
    expect(hashIp("1.2.3.4")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("landingCookieOptions", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("reads NODE_ENV at call time", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(landingCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/candidati",
      maxAge: LANDING_COOKIE_TTL_SEC,
    });
    vi.stubEnv("NODE_ENV", "development");
    expect(landingCookieOptions().secure).toBe(false);
  });
});
