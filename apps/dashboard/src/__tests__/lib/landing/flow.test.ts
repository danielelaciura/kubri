import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/landing/turnstile", () => ({ verifyTurnstile: vi.fn() }));
vi.mock("@/lib/rate-limit", async () => {
  const actual = await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit");
  return { ...actual, consumeRateLimits: vi.fn() };
});
vi.mock("@/lib/candidate-imports/service", () => ({
  STALE_EXTRACTION_MS: 2 * 60 * 1000,
  createUploadTicket: vi.fn(),
  registerUpload: vi.fn(),
  runExtraction: vi.fn(),
  getPublicImport: vi.fn(),
  confirmImport: vi.fn(),
}));

import { verifyTurnstile } from "@/lib/landing/turnstile";
import { consumeRateLimits, RateLimitUnavailableError } from "@/lib/rate-limit";
import {
  confirmImport,
  createUploadTicket,
  getPublicImport,
  registerUpload,
  runExtraction,
} from "@/lib/candidate-imports/service";
import { ImportError, ImportStateError } from "@/lib/candidate-imports/errors";
import { Prisma } from "@/generated/prisma/client";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { passesCvQualityGate } from "@/lib/documents/quality";
import {
  confirmLandingImport,
  PUBLIC_MAX_DOCUMENT_BYTES,
  PUBLIC_MAX_OCR_PAGES,
  registerLandingUpload,
  requestLandingUpload,
  runLandingExtraction,
} from "@/lib/landing/flow";
import type { ActiveLanding } from "@/lib/landing/service";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const IMPORT_ID = "22222222-2222-4222-8222-222222222222";
const LANDING: ActiveLanding = {
  id: "33333333-3333-4333-8333-333333333333", slug: "coop-sole", privacyPolicyUrl: "https://x.it/p",
  organization: { id: "o-1", name: "Coop Sole" },
  pool: { id: "p-1", isGlobal: false, globalSharing: "WEBHOOK", externalKey: "SOLE", slug: "sole" },
};
const CTX = { ip: "1.2.3.4", ipHash: "h".repeat(32) };
// A stored draft carries every field (contactFromDraft validates the whole shape).
const DRAFT = {
  isCv: true, uncertain: [],
  fields: { ...emptyCandidateDraftFields(), firstName: "Ahmed", lastName: "Benali", phone: "333 1234567" },
};

describe("requestLandingUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(verifyTurnstile).mockResolvedValue(true);
    m(consumeRateLimits).mockResolvedValue(true);
    m(createUploadTicket).mockResolvedValue({ importId: IMPORT_ID, storagePath: "p-1/x/cv.pdf", token: "t" });
  });
  const input = { fileName: "cv.pdf", fileSize: 1000, turnstileToken: "tok" };

  it("checks captcha, rate limits, then issues a ticket with the public cap", async () => {
    const r = await requestLandingUpload(LANDING, input, CTX);
    expect(r).toEqual({ ok: true, data: { importId: IMPORT_ID, storagePath: "p-1/x/cv.pdf", token: "t" } });
    expect(m(verifyTurnstile)).toHaveBeenCalledWith("tok", "1.2.3.4");
    const rules = m(consumeRateLimits).mock.calls[0]![0] as { key: string; limit: number }[];
    expect(rules.map((r) => r.key)).toEqual([
      `landing:ip:${CTX.ipHash}:h`, `landing:ip:${CTX.ipHash}:d`, `landing:page:${LANDING.id}:d`,
    ]);
    expect(m(createUploadTicket)).toHaveBeenCalledWith({
      poolId: "p-1", fileName: "cv.pdf", fileSize: 1000, maxBytes: PUBLIC_MAX_DOCUMENT_BYTES,
    });
  });

  it("refuses oversize or empty files before the captcha", async () => {
    await expect(requestLandingUpload(LANDING, { ...input, fileSize: PUBLIC_MAX_DOCUMENT_BYTES + 1 }, CTX))
      .resolves.toEqual({ ok: false, error: "FILE_TOO_LARGE" });
    await expect(requestLandingUpload(LANDING, { ...input, fileSize: 0 }, CTX))
      .resolves.toEqual({ ok: false, error: "UNSUPPORTED_TYPE" });
    expect(m(verifyTurnstile)).not.toHaveBeenCalled();
  });

  it("maps captcha failure, rate limit and limiter outage", async () => {
    m(verifyTurnstile).mockResolvedValueOnce(false);
    await expect(requestLandingUpload(LANDING, input, CTX)).resolves.toEqual({ ok: false, error: "CAPTCHA_FAILED" });
    m(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(requestLandingUpload(LANDING, input, CTX)).resolves.toEqual({ ok: false, error: "RATE_LIMITED" });
    m(consumeRateLimits).mockRejectedValueOnce(new RateLimitUnavailableError());
    await expect(requestLandingUpload(LANDING, input, CTX)).resolves.toEqual({ ok: false, error: "UNAVAILABLE" });
    expect(m(createUploadTicket)).not.toHaveBeenCalled();
  });

  it("rejects invalid input", async () => {
    await expect(requestLandingUpload(LANDING, { fileName: "", fileSize: 10, turnstileToken: "t" }, CTX))
      .resolves.toEqual({ ok: false, error: "VALIDATION" });
  });
});

describe("registerLandingUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers as PUBLIC_LINK with inspection and the public cap", async () => {
    m(registerUpload).mockResolvedValueOnce({ importId: IMPORT_ID });
    await expect(registerLandingUpload(LANDING, IMPORT_ID, "cv.pdf")).resolves.toEqual({ ok: true, data: null });
    expect(m(registerUpload)).toHaveBeenCalledWith({
      importId: IMPORT_ID, organizationId: "o-1", poolId: "p-1", origin: "PUBLIC_LINK",
      createdById: null, fileName: "cv.pdf", maxBytes: PUBLIC_MAX_DOCUMENT_BYTES, inspect: true,
    });
  });

  it("maps ImportError codes", async () => {
    m(registerUpload).mockRejectedValueOnce(new ImportError("REJECTED_FILE"));
    await expect(registerLandingUpload(LANDING, IMPORT_ID, "cv.pdf")).resolves.toEqual({ ok: false, error: "REJECTED_FILE" });
  });
});

describe("runLandingExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(consumeRateLimits).mockResolvedValue(true);
  });

  it("returns the contact prefill without spending budget when already READY", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    const r = await runLandingExtraction(LANDING, IMPORT_ID);
    expect(r).toEqual({ ok: true, data: { firstName: "Ahmed", lastName: "Benali", phone: "333 1234567", email: "" } });
    expect(m(consumeRateLimits)).not.toHaveBeenCalled();
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("spends the per-import then the global budget, then extracts with public options", async () => {
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    const r = await runLandingExtraction(LANDING, IMPORT_ID);
    expect(r.ok).toBe(true);
    const rules = m(consumeRateLimits).mock.calls[0]![0] as { key: string }[];
    expect(rules.map((x) => x.key)).toEqual([`landing:import:${IMPORT_ID}:d`, "landing:extractions:d"]);
    expect(m(runExtraction)).toHaveBeenCalledWith(IMPORT_ID, {
      maxOcrPages: PUBLIC_MAX_OCR_PAGES, textGate: passesCvQualityGate, rejectNonCv: true,
    });
  });

  it("returns BUDGET_EXHAUSTED without extracting", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null });
    m(consumeRateLimits).mockResolvedValueOnce(false);
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "BUDGET_EXHAUSTED" });
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("returns the stored failure code", async () => {
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "NOT_A_CV", draft: null });
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "NOT_A_CV" });
  });

  it("returns SESSION_EXPIRED for an unknown or other-landing import", async () => {
    m(getPublicImport).mockResolvedValueOnce(null);
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "SESSION_EXPIRED" });
  });

  it("re-entry on a final failure returns its code without spending budget", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "NOT_A_CV", draft: null });
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "NOT_A_CV" });
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "bogus", draft: null });
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "INTERNAL_ERROR" });
    expect(m(consumeRateLimits)).not.toHaveBeenCalled();
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("a retryable failure is retried under budget", async () => {
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "LLM_TIMEOUT", draft: null })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toMatchObject({ ok: true });
    expect(m(consumeRateLimits)).toHaveBeenCalledTimes(1);
    expect(m(runExtraction)).toHaveBeenCalledTimes(1);
  });

  it("a fresh EXTRACTING import is IN_PROGRESS without spending budget", async () => {
    const now = new Date("2026-10-29T10:00:00Z");
    m(getPublicImport).mockResolvedValueOnce({
      id: IMPORT_ID, status: "EXTRACTING", errorCode: null, draft: null, updatedAt: new Date(now.getTime() - 30_000),
    });
    await expect(runLandingExtraction(LANDING, IMPORT_ID, now)).resolves.toEqual({ ok: false, error: "IN_PROGRESS" });
    expect(m(consumeRateLimits)).not.toHaveBeenCalled();
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("a stale EXTRACTING import is re-run under budget", async () => {
    const now = new Date("2026-10-29T10:00:00Z");
    m(getPublicImport)
      .mockResolvedValueOnce({
        id: IMPORT_ID, status: "EXTRACTING", errorCode: null, draft: null, updatedAt: new Date(now.getTime() - 3 * 60_000),
      })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    await expect(runLandingExtraction(LANDING, IMPORT_ID, now)).resolves.toMatchObject({ ok: true });
    expect(m(consumeRateLimits)).toHaveBeenCalledTimes(1);
    expect(m(runExtraction)).toHaveBeenCalledTimes(1);
  });

  it("still EXTRACTING after the run (another request holds it) is IN_PROGRESS", async () => {
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "UPLOADED", errorCode: null, draft: null })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "EXTRACTING", errorCode: null, draft: null, updatedAt: new Date() });
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "IN_PROGRESS" });
  });

  it("a database error becomes INTERNAL_ERROR", async () => {
    m(getPublicImport).mockRejectedValueOnce(new Error("db down"));
    await expect(runLandingExtraction(LANDING, IMPORT_ID)).resolves.toEqual({ ok: false, error: "INTERNAL_ERROR" });
  });
});

describe("confirmLandingImport", () => {
  const CONTACT = {
    firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567", email: "",
    privacyAccepted: true, shareWithGlobal: true,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    m(getPublicImport).mockResolvedValue({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT });
    m(confirmImport).mockResolvedValue({ candidateId: "c-1", attached: false, documentId: "d-1" });
  });

  it("confirms in public mode with consent and an in-transaction audit", async () => {
    const now = new Date("2026-10-29T10:00:00Z");
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX, now)).resolves.toEqual({ ok: true, data: null });
    const args = m(confirmImport).mock.calls[0]![0];
    expect(args).toMatchObject({
      importId: IMPORT_ID, organizationId: "o-1", poolId: "p-1", userId: null, channel: "landing_cv",
      consentToShare: true, attachToExistingByPhone: true,
      rawPayloadExtra: {
        landingPageId: LANDING.id,
        consent: {
          privacyPolicyUrl: "https://x.it/p", acceptedAt: "2026-10-29T10:00:00.000Z",
          shareWithGlobal: true, textVersion: "2026-10-29",
        },
      },
    });
    expect(args.fields).toMatchObject({ firstName: "Ahmed", phone: "+39 333 1234567" });
    expect(args.audit).toEqual({
      action: "candidate_import.public_confirm",
      organizationId: "o-1",
      metadata: {
        ipHash: CTX.ipHash,
        consent: {
          privacyPolicyUrl: "https://x.it/p", acceptedAt: "2026-10-29T10:00:00.000Z",
          shareWithGlobal: true, textVersion: "2026-10-29",
        },
      },
    });
  });

  it("ignores the share checkbox when the pool is not consent-driven", async () => {
    await confirmLandingImport({ ...LANDING, pool: { ...LANDING.pool, globalSharing: "NEVER" } }, IMPORT_ID, CONTACT, CTX);
    expect(m(confirmImport).mock.calls[0]![0].consentToShare).toBe(false);
  });

  it("rejects an invalid contact", async () => {
    await expect(confirmLandingImport(LANDING, IMPORT_ID, { ...CONTACT, privacyAccepted: false }, CTX))
      .resolves.toEqual({ ok: false, error: "VALIDATION" });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("refuses an import that is not READY", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "FAILED", errorCode: "NOT_A_CV", draft: null });
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("an already completed import confirms idempotently", async () => {
    m(getPublicImport).mockResolvedValueOnce({ id: IMPORT_ID, status: "COMPLETED", errorCode: null, draft: null });
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: true, data: null });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("a failing audit write rolls back the confirm", async () => {
    m(confirmImport).mockRejectedValueOnce(new Error("audit insert failed"));
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: false, error: "INTERNAL_ERROR" });
  });

  it("a lost confirm race against a completed import succeeds", async () => {
    m(confirmImport).mockRejectedValueOnce(new ImportStateError("COMPLETED"));
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "COMPLETED", errorCode: null, draft: null });
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: true, data: null });
  });

  it("a lost confirm race against a discard is NOT_FOUND", async () => {
    m(confirmImport).mockRejectedValueOnce(new ImportStateError("DISCARDED"));
    m(getPublicImport)
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "READY", errorCode: null, draft: DRAFT })
      .mockResolvedValueOnce({ id: IMPORT_ID, status: "DISCARDED", errorCode: null, draft: null });
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("a database error on lookup becomes INTERNAL_ERROR", async () => {
    m(getPublicImport).mockRejectedValueOnce(new Error("db down"));
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: false, error: "INTERNAL_ERROR" });
  });

  it("logs only name and code for Prisma errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    m(confirmImport).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique failed on phone +39 333 1234567", { code: "P2002", clientVersion: "x" }),
    );
    await expect(confirmLandingImport(LANDING, IMPORT_ID, CONTACT, CTX)).resolves.toEqual({ ok: false, error: "INTERNAL_ERROR" });
    expect(spy).toHaveBeenCalledWith("[landing] confirm failed", { name: "PrismaClientKnownRequestError", code: "P2002" });
    spy.mockRestore();
  });
});
