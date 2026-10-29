import { z } from "zod/v4";
import {
  confirmImport,
  createUploadTicket,
  getPublicImport,
  registerUpload,
  runExtraction,
  type UploadTicket,
} from "@/lib/candidate-imports/service";
import {
  ImportError,
  ImportNotFoundError,
  ImportStateError,
  isImportErrorCode,
  type ImportErrorCode,
} from "@/lib/candidate-imports/errors";
import { passesCvQualityGate } from "@/lib/documents/quality";
import { consumeRateLimits, RateLimitUnavailableError, type RateLimitRule } from "@/lib/rate-limit";
import { logAudit } from "@/lib/audit";
import { verifyTurnstile } from "./turnstile";
import { contactFromDraft, landingContactSchema, mergeContactIntoDraft, type ContactPrefill } from "./contact";
import type { ActiveLanding } from "./service";

export const PUBLIC_MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const PUBLIC_MAX_OCR_PAGES = 3;
/** Bump when the consent copy in the dictionaries changes. */
export const CONSENT_TEXT_VERSION = "2026-10-29";

const HOUR = 3600;
const DAY = 24 * HOUR;
const LIMITS = {
  perIpHour: 3,
  perIpDay: 10,
  perLandingDay: 100,
  /** Global budget cap on paid extractions (OCR + LLM), all landings together. */
  extractionsDay: 300,
  /** One retry per import. */
  perImportDay: 2,
} as const;

export type LandingErrorCode =
  | ImportErrorCode
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED"
  | "BUDGET_EXHAUSTED"
  | "UNAVAILABLE"
  | "SESSION_EXPIRED"
  | "VALIDATION"
  | "NOT_FOUND";

export type LandingResult<T> = { ok: true; data: T } | { ok: false; error: LandingErrorCode };

export interface RequestContext {
  ip: string | null;
  ipHash: string;
}

const fail = (error: LandingErrorCode): { ok: false; error: LandingErrorCode } => ({ ok: false, error });

function toLandingError(e: unknown, tag: string): { ok: false; error: LandingErrorCode } {
  if (e instanceof ImportError) return fail(e.code);
  if (e instanceof ImportNotFoundError || e instanceof ImportStateError) return fail("NOT_FOUND");
  if (e instanceof RateLimitUnavailableError) return fail("UNAVAILABLE");
  // Errors can carry candidate data: name + message only.
  console.error(`[landing] ${tag} failed`, e instanceof Error ? { name: e.name, message: e.message } : {});
  return fail("INTERNAL_ERROR");
}

const requestSchema = z.object({
  fileName: z.string().min(1).max(255),
  fileSize: z.number().int().nonnegative(),
  turnstileToken: z.string().max(4096),
});

/**
 * Step 1: cheap checks first (size), then captcha, then rate limits, then a
 * signed upload ticket. The caller binds `ticket.importId` to the browser
 * with the import cookie.
 */
export async function requestLandingUpload(
  landing: ActiveLanding,
  input: unknown,
  ctx: RequestContext,
): Promise<LandingResult<UploadTicket>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const { fileName, fileSize, turnstileToken } = parsed.data;
  if (fileSize === 0) return fail("UNSUPPORTED_TYPE");
  if (fileSize > PUBLIC_MAX_DOCUMENT_BYTES) return fail("FILE_TOO_LARGE");

  if (!(await verifyTurnstile(turnstileToken, ctx.ip))) return fail("CAPTCHA_FAILED");

  const rules: RateLimitRule[] = [
    { key: `landing:ip:${ctx.ipHash}:h`, limit: LIMITS.perIpHour, windowSec: HOUR },
    { key: `landing:ip:${ctx.ipHash}:d`, limit: LIMITS.perIpDay, windowSec: DAY },
    { key: `landing:page:${landing.id}:d`, limit: LIMITS.perLandingDay, windowSec: DAY },
  ];
  try {
    if (!(await consumeRateLimits(rules))) return fail("RATE_LIMITED");
    const ticket = await createUploadTicket({
      poolId: landing.pool.id,
      fileName,
      fileSize,
      maxBytes: PUBLIC_MAX_DOCUMENT_BYTES,
    });
    return { ok: true, data: ticket };
  } catch (e) {
    return toLandingError(e, "request upload");
  }
}

/** Step 2: verify + inspect the stored file and create the PUBLIC_LINK import. */
export async function registerLandingUpload(
  landing: ActiveLanding,
  importId: string,
  fileName: string,
): Promise<LandingResult<null>> {
  if (!fileName || fileName.length > 255) return fail("VALIDATION");
  try {
    await registerUpload({
      importId,
      organizationId: landing.organization.id,
      poolId: landing.pool.id,
      origin: "PUBLIC_LINK",
      createdById: null,
      fileName,
      maxBytes: PUBLIC_MAX_DOCUMENT_BYTES,
      inspect: true,
    });
    return { ok: true, data: null };
  } catch (e) {
    return toLandingError(e, "register upload");
  }
}

/**
 * Step 3: run the paid extraction under the global budget and return the
 * contact prefill. Re-entrant: a READY import returns its prefill for free.
 */
export async function runLandingExtraction(
  landing: ActiveLanding,
  importId: string,
): Promise<LandingResult<ContactPrefill>> {
  const imp = await getPublicImport(importId, landing.pool.id);
  if (!imp) return fail("SESSION_EXPIRED");
  if (imp.status === "READY") return { ok: true, data: contactFromDraft(imp.draft) };
  if (imp.status === "COMPLETED" || imp.status === "DISCARDED") return fail("SESSION_EXPIRED");

  try {
    // Per-import first: rules stop at the first refusal, so one import
    // retrying cannot burn the global budget.
    const withinBudget = await consumeRateLimits([
      { key: `landing:import:${imp.id}:d`, limit: LIMITS.perImportDay, windowSec: DAY },
      { key: "landing:extractions:d", limit: LIMITS.extractionsDay, windowSec: DAY },
    ]);
    if (!withinBudget) return fail("BUDGET_EXHAUSTED");
    await runExtraction(imp.id, {
      maxOcrPages: PUBLIC_MAX_OCR_PAGES,
      textGate: passesCvQualityGate,
      rejectNonCv: true,
    });
  } catch (e) {
    return toLandingError(e, "extraction");
  }

  const after = await getPublicImport(imp.id, landing.pool.id);
  if (after?.status === "READY") return { ok: true, data: contactFromDraft(after.draft) };
  if (after?.status === "FAILED" && isImportErrorCode(after.errorCode)) return fail(after.errorCode);
  return fail("INTERNAL_ERROR");
}

/** Step 4: the candidate's confirmed contact + consent → candidate (or CV attached). */
export async function confirmLandingImport(
  landing: ActiveLanding,
  importId: string,
  input: unknown,
  ctx: RequestContext,
  now = new Date(),
): Promise<LandingResult<null>> {
  const parsed = landingContactSchema.safeParse(input);
  if (!parsed.success) return fail("VALIDATION");
  const contact = parsed.data;

  const imp = await getPublicImport(importId, landing.pool.id);
  if (!imp) return fail("SESSION_EXPIRED");
  if (imp.status === "COMPLETED") return { ok: true, data: null };
  if (imp.status !== "READY") return fail("NOT_FOUND");

  // The sharing checkbox only means something for consent-driven pools.
  const shareWithGlobal = landing.pool.globalSharing === "WEBHOOK" && contact.shareWithGlobal;

  const consent = {
    privacyPolicyUrl: landing.privacyPolicyUrl,
    acceptedAt: now.toISOString(),
    shareWithGlobal,
    textVersion: CONSENT_TEXT_VERSION,
  };

  try {
    const { candidateId, attached, documentId } = await confirmImport({
      importId: imp.id,
      organizationId: landing.organization.id,
      poolId: landing.pool.id,
      userId: null,
      fields: mergeContactIntoDraft(imp.draft, contact),
      channel: "landing_cv",
      consentToShare: shareWithGlobal,
      attachToExistingByPhone: true,
      rawPayloadExtra: { landingPageId: landing.id, consent },
    });
    try {
      await logAudit({
        userId: null,
        organizationId: landing.organization.id,
        action: "candidate_import.public_confirm",
        resourceType: "candidate_import",
        resourceId: imp.id,
        // The consent record lives here too: on attach the existing
        // candidate's rawPayload is not touched (GDPR traceability).
        metadata: { candidateId, attached, documentId, ipHash: ctx.ipHash, consent },
      });
    } catch (e) {
      console.error("[landing] audit log failed", e instanceof Error ? e.message : e);
    }
    return { ok: true, data: null };
  } catch (e) {
    return toLandingError(e, "confirm");
  }
}
