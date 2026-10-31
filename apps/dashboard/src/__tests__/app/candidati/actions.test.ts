import { describe, it, expect, beforeEach, vi } from "vitest";

let headerInit: Record<string, string> = { "x-forwarded-for": "1.2.3.4, 10.0.0.1" };
const cookieJar = new Map<string, string>();
const cookieStore = {
  get: vi.fn((name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined)),
  set: vi.fn((...[name, value]: [string, string, unknown?]) => void cookieJar.set(name, value)),
  delete: vi.fn((name: string) => void cookieJar.delete(name)),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => cookieStore),
  headers: vi.fn(async () => new Headers(headerInit)),
}));
vi.mock("@/lib/landing/service", () => ({ getActiveLandingBySlug: vi.fn() }));
vi.mock("@/lib/landing/flow", () => ({
  requestLandingUpload: vi.fn(),
  registerLandingUpload: vi.fn(),
  runLandingExtraction: vi.fn(),
  confirmLandingImport: vi.fn(),
}));

import { getActiveLandingBySlug } from "@/lib/landing/service";
import {
  confirmLandingImport,
  registerLandingUpload,
  requestLandingUpload,
  runLandingExtraction,
} from "@/lib/landing/flow";
import { LANDING_COOKIE_NAME, hashIp, landingCookieOptions, signImportCookie } from "@/lib/landing/import-cookie";
import {
  confirmLandingImportAction,
  registerLandingUploadAction,
  requestLandingUploadAction,
  runLandingExtractionAction,
} from "@/app/(public)/candidati/[slug]/actions";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const LANDING = { id: "33333333-3333-4333-8333-333333333333", pool: { id: "p-1" } };

describe("landing server actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    headerInit = { "x-forwarded-for": "1.2.3.4, 10.0.0.1" };
    cookieJar.clear();
    vi.stubEnv("LANDING_COOKIE_SECRET", "s".repeat(32));
    m(getActiveLandingBySlug).mockResolvedValue(LANDING);
  });

  it("returns NOT_FOUND for an unknown slug", async () => {
    m(getActiveLandingBySlug).mockResolvedValueOnce(null);
    await expect(requestLandingUploadAction("nope", { fileName: "a", fileSize: 1, turnstileToken: "" }))
      .resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("request: passes the first forwarded IP and binds the import in a cookie, without exposing its id", async () => {
    m(requestLandingUpload).mockResolvedValueOnce({ ok: true, data: { importId: IMPORT_ID, storagePath: "p-1/x/cv.pdf", token: "t" } });
    const r = await requestLandingUploadAction("coop-sole", { fileName: "cv.pdf", fileSize: 10, turnstileToken: "tok" });
    expect(r).toEqual({ ok: true, data: { storagePath: "p-1/x/cv.pdf", token: "t" } });
    expect(m(requestLandingUpload).mock.calls[0]![2]).toEqual({ ip: "1.2.3.4", ipHash: hashIp("1.2.3.4") });
    const [, , opts] = cookieStore.set.mock.calls[0]!;
    const expected = landingCookieOptions();
    expect(opts).toMatchObject({ httpOnly: expected.httpOnly, sameSite: expected.sameSite, path: expected.path });
    expect(cookieJar.get(LANDING_COOKIE_NAME)).toContain(IMPORT_ID);
  });

  it("later steps read the import id only from a valid cookie of this landing", async () => {
    await expect(runLandingExtractionAction("coop-sole")).resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: "44444444-4444-4444-8444-444444444444" }));
    await expect(runLandingExtractionAction("coop-sole")).resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
    expect(m(runLandingExtraction)).not.toHaveBeenCalled();

    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: LANDING.id }));
    m(registerLandingUpload).mockResolvedValueOnce({ ok: true, data: null });
    await registerLandingUploadAction("coop-sole", "cv.pdf");
    expect(m(registerLandingUpload)).toHaveBeenCalledWith(LANDING, IMPORT_ID, "cv.pdf");
  });

  it("confirm clears the cookie on success", async () => {
    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: LANDING.id }));
    m(confirmLandingImport).mockResolvedValueOnce({ ok: true, data: null });
    await confirmLandingImportAction("coop-sole", { firstName: "A" });
    expect(m(confirmLandingImport).mock.calls[0]!.slice(0, 3)).toEqual([LANDING, IMPORT_ID, { firstName: "A" }]);
    expect(cookieStore.delete).toHaveBeenCalledWith({ name: LANDING_COOKIE_NAME, path: "/candidati" });
  });

  it("returns UNAVAILABLE (and logs no values) when the IP salt is missing in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("LANDING_IP_SALT", "");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    cookieJar.set(LANDING_COOKIE_NAME, signImportCookie({ importId: IMPORT_ID, landingId: LANDING.id }));
    await expect(requestLandingUploadAction("coop-sole", { fileName: "cv.pdf", fileSize: 10, turnstileToken: "t" }))
      .resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    await expect(confirmLandingImportAction("coop-sole", {})).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(m(requestLandingUpload)).not.toHaveBeenCalled();
    expect(m(confirmLandingImport)).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("[landing] request context unavailable");
    log.mockRestore();
    vi.unstubAllEnvs();
  });

  it("returns UNAVAILABLE before spending any budget when the cookie secret is missing", async () => {
    vi.stubEnv("LANDING_COOKIE_SECRET", "short");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(requestLandingUploadAction("coop-sole", { fileName: "cv.pdf", fileSize: 10, turnstileToken: "t" }))
      .resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(m(requestLandingUpload)).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    log.mockRestore();
  });

  it("returns UNAVAILABLE when the landing lookup throws", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    m(getActiveLandingBySlug).mockRejectedValueOnce(new Error("db down"));
    await expect(runLandingExtractionAction("coop-sole")).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    log.mockRestore();
  });

  it("prefers x-vercel-forwarded-for, then x-real-ip, then the first x-forwarded-for hop", async () => {
    m(requestLandingUpload).mockResolvedValue({ ok: false, error: "RATE_LIMITED" });
    const input = { fileName: "cv.pdf", fileSize: 10, turnstileToken: "t" };
    headerInit = { "x-vercel-forwarded-for": "9.9.9.9", "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.2.3.4" };
    await requestLandingUploadAction("coop-sole", input);
    expect(m(requestLandingUpload).mock.calls[0]![2].ip).toBe("9.9.9.9");
    headerInit = { "x-real-ip": "8.8.8.8", "x-forwarded-for": "1.2.3.4" };
    await requestLandingUploadAction("coop-sole", input);
    expect(m(requestLandingUpload).mock.calls[1]![2].ip).toBe("8.8.8.8");
  });

  it("rejects a non-string slug", async () => {
    await expect(runLandingExtractionAction({} as never)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m(getActiveLandingBySlug)).not.toHaveBeenCalled();
  });
});
