import { z } from "zod/v4";
import { Prisma } from "@/generated/prisma/client";
import {
  STALE_EXTRACTION_MS,
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
  RETRYABLE_IMPORT_ERRORS,
  type ImportErrorCode,
} from "@/lib/candidate-imports/errors";
import { passesCvQualityGate } from "@/lib/documents/quality";
import { consumeRateLimits, RateLimitUnavailableError, type RateLimitRule } from "@/lib/rate-limit";
import { verifyTurnstile } from "./turnstile";
import { contactFromDraft, landingContactSchema, mergeContactIntoDraft, type ContactPrefill } from "./contact";
import type { ActiveLanding } from "./service";

export const PUBLIC_MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
export const PUBLIC_MAX_OCR_PAGES = 3;
/** Bump when the consent copy in the dictionaries changes. */
export const CONSENT_TEXT_VERSION = "2026-10-29";

const HOUR = 3600;
const DAY = 24 * HOUR;
const warnedEnv = new Set<string>();

function intFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  // Plain digits only: Number() would also accept "1e2" or "0x10".
  const n = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  if (Number.isSafeInteger(n) && n > 0) return n;
  if (!warnedEnv.has(name)) {
    warnedEnv.add(name);
    console.warn(`[landing] invalid ${name}, using default ${fallback}`);
  }
  return fallback;
}

/** Read at call time so deployments (and tests) can tune limits via env. */
function getLimits() {
  return {
    perIpHour: intFromEnv("LANDING_LIMIT_IP_HOUR", 5),
    perIpDay: intFromEnv("LANDING_LIMIT_IP_DAY", 20),
    perLandingDay: intFromEnv("LANDING_LIMIT_PAGE_DAY", 100),
    /** Paid extractions (OCR + LLM) per landing: one page cannot eat the global budget. */
    perLandingExtractionsDay: intFromEnv("LANDING_LIMIT_PAGE_EXTRACTIONS_DAY", 100),
    /** Global budget cap on paid extractions, all landings together. */
    extractionsDay: intFromEnv("LANDING_LIMIT_EXTRACTIONS_DAY", 300),
    /** One retry per import. */
    perImportDay: intFromEnv("LANDING_LIMIT_IMPORT_DAY", 2),
  };
}

/** Upload tickets live ~1h; a registration slot outlives them. */
const REGISTER_WINDOW_SEC = 2 * HOUR;

export type LandingErrorCode =
  | ImportErrorCode
  | "CAPTCHA_FAILED"
  | "RATE_LIMITED"
  | "BUDGET_EXHAUSTED"
  | "UNAVAILABLE"
  | "SESSION_EXPIRED"
  /** Another request is extracting this import right now: poll again. */
  | "IN_PROGRESS"
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
  // Errors can carry candidate data: Prisma messages embed field values, so
  // log name + code only for them; name + message for the rest.
  if (
    e instanceof Prisma.PrismaClientKnownRequestError ||
    e instanceof Prisma.PrismaClientValidationError ||
    e instanceof Prisma.PrismaClientUnknownRequestError
  ) {
    const code = e instanceof Prisma.PrismaClientKnownRequestError ? e.code : undefined;
    console.error(`[landing] ${tag} failed`, { name: e.name, code });
  } else {
    console.error(`[landing] ${tag} failed`, e instanceof Error ? { name: e.name, message: e.message } : {});
  }
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

  const LIMITS = getLimits();
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
    // One ticket = one registration: a rejected file can't be swapped and
    // re-registered without going back through Turnstile and the IP limits.
    const slot = await consumeRateLimits([
      { key: `landing:register:${importId}`, limit: 1, windowSec: REGISTER_WINDOW_SEC },
    ]);
    if (!slot) return fail("SESSION_EXPIRED");
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
  now = new Date(),
): Promise<LandingResult<ContactPrefill>> {
  try {
    return await extractUnderBudget(landing, importId, now);
  } catch (e) {
    return toLandingError(e, "extraction");
  }
}

async function extractUnderBudget(
  landing: ActiveLanding,
  importId: string,
  now: Date,
): Promise<LandingResult<ContactPrefill>> {
  const imp = await getPublicImport(importId, landing.pool.id);
  if (!imp) return fail("SESSION_EXPIRED");
  if (imp.status === "READY") return { ok: true, data: contactFromDraft(imp.draft) };
  if (imp.status === "COMPLETED" || imp.status === "DISCARDED") return fail("SESSION_EXPIRED");
  // A final failure is re-reported for free; only retryable ones re-run.
  if (imp.status === "FAILED") {
    if (!isImportErrorCode(imp.errorCode)) return fail("INTERNAL_ERROR");
    if (!RETRYABLE_IMPORT_ERRORS.includes(imp.errorCode)) return fail(imp.errorCode);
  }
  // A fresh extraction belongs to another request (second tab, client retry):
  // don't count budget, let the client poll. A stale one is re-claimed below.
  if (imp.status === "EXTRACTING" && now.getTime() - imp.updatedAt.getTime() < STALE_EXTRACTION_MS) {
    return fail("IN_PROGRESS");
  }

  // Narrowest first: rules stop at the first refusal, so one import (or one
  // landing) cannot burn the shared budget.
  const LIMITS = getLimits();
  const withinBudget = await consumeRateLimits([
    { key: `landing:import:${imp.id}:d`, limit: LIMITS.perImportDay, windowSec: DAY },
    { key: `landing:page:${landing.id}:extractions:d`, limit: LIMITS.perLandingExtractionsDay, windowSec: DAY },
    { key: "landing:extractions:d", limit: LIMITS.extractionsDay, windowSec: DAY },
  ]);
  if (!withinBudget) return fail("BUDGET_EXHAUSTED");
  await runExtraction(imp.id, {
    maxOcrPages: PUBLIC_MAX_OCR_PAGES,
    textGate: passesCvQualityGate,
    rejectNonCv: true,
  });

  const after = await getPublicImport(imp.id, landing.pool.id);
  if (after?.status === "READY") return { ok: true, data: contactFromDraft(after.draft) };
  if (after?.status === "FAILED" && isImportErrorCode(after.errorCode)) return fail(after.errorCode);
  if (after?.status === "EXTRACTING") return fail("IN_PROGRESS");
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

  try {
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
      await confirmImport({
        importId: imp.id,
        organizationId: landing.organization.id,
        poolId: landing.pool.id,
        userId: null,
        fields: mergeContactIntoDraft(imp.draft, contact),
        channel: "landing_cv",
        consentToShare: shareWithGlobal,
        attachToExistingByPhone: true,
        rawPayloadExtra: { landingPageId: landing.id, consent },
        // Written inside the confirm transaction: the consent proof exists iff
        // the candidate/document does. On attach the existing candidate's
        // rawPayload is untouched, so this row is the only consent record.
        audit: {
          action: "candidate_import.public_confirm",
          organizationId: landing.organization.id,
          metadata: { ipHash: ctx.ipHash, consent },
        },
      });
    } catch (e) {
      // Lost a race (double submit, second tab): fine if the other one completed it.
      if (e instanceof ImportStateError) {
        const again = await getPublicImport(imp.id, landing.pool.id);
        if (again?.status === "COMPLETED") return { ok: true, data: null };
      }
      throw e;
    }
    return { ok: true, data: null };
  } catch (e) {
    return toLandingError(e, "confirm");
  }
}
