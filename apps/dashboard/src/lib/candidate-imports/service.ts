import { randomUUID } from "node:crypto";
import type { CandidateFields } from "@kubri/contracts";
import { prisma } from "@/lib/db";
import { Prisma, type CandidateImportOrigin } from "@/generated/prisma/client";
import { detectDocumentKind, DOCUMENT_MIME, MAX_DOCUMENT_BYTES } from "@/lib/documents/detect";
import type { DocumentKind } from "@/lib/documents/detect";
import { inspectPublicDocument } from "@/lib/documents/inspect";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { extractCandidateDraft } from "@/lib/candidates/cv-extraction";
import {
  buildDashboardCandidateInput,
  type CandidateCreateChannel,
} from "@/lib/candidates/dashboard-create";
import { findCandidateIdBySamePhone } from "@/lib/candidates/duplicates";
import { refreshCandidateEmbedding, upsertCandidate } from "@/lib/candidates/ingest";
import {
  buildDocumentPath,
  createDocumentUploadUrl,
  downloadCandidateDocument,
  removeCandidateDocuments,
  replaceCandidateDocument,
} from "@/lib/storage/candidate-documents";
import {
  ImportError,
  ImportNotFoundError,
  ImportStateError,
  RETRYABLE_IMPORT_ERRORS,
  toImportErrorCode,
} from "./errors";

/**
 * An EXTRACTING import older than this was killed mid-run and may be
 * re-claimed. Derived from the timeouts: OCR 20 s + LLM 2x15 s ~= 50 s, plus
 * download and parse, which fits the review page's 60 s maxDuration; 2 min
 * leaves headroom.
 */
const STALE_EXTRACTION_MS = 2 * 60 * 1000;
/** Open imports untouched for this long are discarded by the nightly cron. */
const STALE_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ["UPLOADED", "EXTRACTING", "READY", "FAILED"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Server-action arguments are untrusted: an object here would become a Prisma operator. */
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

export interface UploadTicket {
  importId: string;
  storagePath: string;
  token: string;
}

/**
 * Step 1 of an upload: pick the import id and storage path server-side and
 * return a signed upload token for exactly that path. Nothing is written to
 * the DB yet. Callers check auth and that the pool belongs to the org.
 * Throws ImportError(FILE_TOO_LARGE | STORAGE_ERROR).
 */
export async function createUploadTicket(input: {
  poolId: string;
  fileName: string;
  fileSize: number;
  /** Public uploads pass a lower cap. */
  maxBytes?: number;
}): Promise<UploadTicket> {
  if (input.fileSize > (input.maxBytes ?? MAX_DOCUMENT_BYTES)) throw new ImportError("FILE_TOO_LARGE");
  const importId = randomUUID();
  const storagePath = buildDocumentPath(input.poolId, importId, input.fileName);
  try {
    const { token } = await createDocumentUploadUrl(storagePath);
    return { importId, storagePath, token };
  } catch (e) {
    throw new ImportError("STORAGE_ERROR", e);
  }
}

export interface RegisterUploadInput {
  importId: string;
  organizationId: string;
  poolId: string;
  origin: CandidateImportOrigin;
  createdById: string | null;
  fileName: string;
  /** Public uploads pass a lower cap. */
  maxBytes?: number;
  /** Public uploads: reject active content, re-encode images (inspectPublicDocument). */
  inspect?: boolean;
}

async function removeQuietly(storagePath: string, why: string): Promise<void> {
  try {
    await removeCandidateDocuments([storagePath]);
  } catch (e) {
    console.error(`[candidate import] ${why} removal failed`, { storagePath, error: e });
  }
}

/**
 * Step 2, after the browser uploaded to the ticket's path: re-derive the
 * path, verify the stored object (real size + magic bytes — the client's
 * claims are not trusted), delete it if invalid, else create the UPLOADED
 * import. Re-registering the same importId fails on the primary key.
 * Throws ImportError(STORAGE_ERROR | FILE_TOO_LARGE | UNSUPPORTED_TYPE).
 */
export async function registerUpload(input: RegisterUploadInput): Promise<{ importId: string }> {
  const storagePath = buildDocumentPath(input.poolId, input.importId, input.fileName);

  let bytes: Uint8Array;
  try {
    bytes = await downloadCandidateDocument(storagePath);
  } catch (e) {
    throw new ImportError("STORAGE_ERROR", e);
  }

  const tooLarge = bytes.byteLength > (input.maxBytes ?? MAX_DOCUMENT_BYTES);
  const detected = tooLarge ? null : detectDocumentKind(bytes);
  if (!detected) {
    await removeQuietly(storagePath, "invalid upload");
    throw new ImportError(tooLarge ? "FILE_TOO_LARGE" : "UNSUPPORTED_TYPE");
  }

  let stored = bytes;
  let kind: DocumentKind = detected;
  if (input.inspect) {
    const inspected = await inspectPublicDocument(bytes, detected);
    if (!inspected.ok) {
      console.warn("[candidate import] public upload rejected", { reason: inspected.reason });
      await removeQuietly(storagePath, "rejected upload");
      throw new ImportError("REJECTED_FILE");
    }
    if (inspected.bytes !== bytes) {
      try {
        await replaceCandidateDocument(storagePath, inspected.bytes, DOCUMENT_MIME[inspected.kind]);
      } catch (e) {
        await removeQuietly(storagePath, "unreplaceable upload");
        throw new ImportError("STORAGE_ERROR", e);
      }
    }
    stored = inspected.bytes;
    kind = inspected.kind;
  }

  await prisma.candidateImport.create({
    data: {
      id: input.importId,
      organizationId: input.organizationId,
      poolId: input.poolId,
      origin: input.origin,
      status: "UPLOADED",
      createdById: input.createdById,
      storagePath,
      fileName: input.fileName.slice(0, 255),
      mimeType: DOCUMENT_MIME[kind],
      fileSize: stored.byteLength,
    },
  });
  return { importId: input.importId };
}

export interface ExtractionOptions {
  /** Cap on OCR pages (public uploads: lower than the operator default). */
  maxOcrPages?: number;
  /** Free pre-LLM check; false → FAILED NOT_A_CV and no LLM call. */
  textGate?: (text: string) => boolean;
  /** isCv=false → FAILED NOT_A_CV (public) instead of a READY warning (operator). */
  rejectNonCv?: boolean;
}

/**
 * Text extraction + LLM draft. Claims the import with a conditional update so
 * concurrent or repeated calls are no-ops; re-claims retryable failures and
 * extractions that were killed mid-run. Never throws for pipeline errors —
 * they end up as status FAILED + errorCode.
 *
 * Not org-scoped: callers must verify the import belongs to the user's
 * organization first (see getImportForOrg).
 */
export async function runExtraction(importId: string, opts: ExtractionOptions = {}): Promise<void> {
  if (!isUuid(importId)) return;
  const claimedAt = new Date();
  const claimed = await prisma.candidateImport.updateMany({
    where: {
      id: importId,
      OR: [
        { status: "UPLOADED" },
        { status: "FAILED", errorCode: { in: [...RETRYABLE_IMPORT_ERRORS] } },
        { status: "EXTRACTING", updatedAt: { lt: new Date(Date.now() - STALE_EXTRACTION_MS) } },
      ],
    },
    data: { status: "EXTRACTING", errorCode: null, updatedAt: claimedAt },
  });
  if (claimed.count === 0) return;

  const imp = await prisma.candidateImport.findUniqueOrThrow({
    where: { id: importId },
    select: { storagePath: true },
  });

  // Final writes only apply while the import is still the one we claimed.
  const finish = async (data: Prisma.CandidateImportUpdateManyMutationInput) => {
    const res = await prisma.candidateImport.updateMany({
      where: { id: importId, status: "EXTRACTING", updatedAt: claimedAt },
      data,
    });
    if (res.count === 0) {
      console.warn("[candidate import] extraction result dropped: import changed state", { importId });
    }
  };

  try {
    const bytes = await downloadCandidateDocument(imp.storagePath);
    const kind = detectDocumentKind(bytes);
    if (!kind) throw new ImportError("FILE_UNREADABLE");
    const extracted = await extractDocumentText(bytes, kind, { maxOcrPages: opts.maxOcrPages });
    // Postgres text/jsonb reject NUL, which unpdf can emit.
    const text = extracted.text.replace(/\u0000/g, "");
    if (opts.textGate && !opts.textGate(text)) {
      await finish({ status: "FAILED", errorCode: "NOT_A_CV" });
      return;
    }
    const draft = await extractCandidateDraft(text);
    if (!draft.isCv && opts.rejectNonCv) {
      await finish({ status: "FAILED", errorCode: "NOT_A_CV" });
      return;
    }
    await finish({
      status: "READY",
      extractedText: text,
      extractionMethod: extracted.method,
      draft: draft as unknown as Prisma.InputJsonValue,
      errorCode: draft.isCv ? null : "NOT_A_CV",
    });
  } catch (e) {
    const code = toImportErrorCode(e);
    // Log the message only: an error's cause chain can carry LLM output (candidate data).
    console.error("[candidate import] extraction failed", {
      importId,
      code,
      message: e instanceof Error ? e.message : String(e),
    });
    await finish({ status: "FAILED", errorCode: code });
  }
}

export interface ConfirmImportInput {
  importId: string;
  organizationId: string;
  /** Null for public-landing imports (no logged-in uploader). */
  userId: string | null;
  fields: CandidateFields;
  channel?: Extract<CandidateCreateChannel, "dashboard_cv" | "landing_cv">;
  /** The candidate's own consent to global sharing (public landing only). */
  consentToShare?: boolean;
  /** Merged into the candidate's rawPayload (landing id, consent record). */
  rawPayloadExtra?: Record<string, unknown>;
  /**
   * Public landing: when a candidate of the import's pool has the same
   * normalized phone, attach the CV to it instead of creating a new row. The
   * existing profile is never modified. Never looks outside the pool.
   */
  attachToExistingByPhone?: boolean;
}

export interface ConfirmImportResult {
  candidateId: string;
  /** True when the CV was attached to an existing candidate. */
  attached: boolean;
}

/**
 * Create the candidate from a READY import (or a FAILED one filled in by
 * hand) — or attach the CV to an existing same-phone candidate — atomically.
 * Idempotent: confirming a COMPLETED import returns its candidate. Throws
 * ImportNotFoundError (wrong org / id) or ImportStateError (discarded, or lost
 * a concurrent confirm).
 */
export async function confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
  const channel = input.channel ?? "dashboard_cv";
  const result = await prisma.$transaction(async (tx) => {
    const imp = await tx.candidateImport.findFirst({
      where: { id: input.importId, organizationId: input.organizationId },
      include: { pool: true },
    });
    if (!imp) throw new ImportNotFoundError();
    if (imp.status === "COMPLETED" && imp.candidateId) {
      return { candidateId: imp.candidateId, row: null, attached: false };
    }

    const claimed = await tx.candidateImport.updateMany({
      where: {
        id: imp.id,
        OR: [
          { status: { in: ["READY", "FAILED"] } },
          // A stuck extraction may be filled in by hand (review page ?manual=1).
          { status: "EXTRACTING", updatedAt: { lt: new Date(Date.now() - STALE_EXTRACTION_MS) } },
        ],
      },
      data: { status: "COMPLETED" },
    });
    if (claimed.count === 0) throw new ImportStateError(imp.status);

    const document = {
      kind: "CV" as const,
      storagePath: imp.storagePath,
      fileName: imp.fileName,
      mimeType: imp.mimeType,
      size: imp.fileSize,
      uploadedById: imp.createdById,
    };
    const closeImport = (candidateId: string) =>
      tx.candidateImport.update({
        where: { id: imp.id },
        data: { candidateId, extractedText: null, draft: Prisma.DbNull },
      });

    if (input.attachToExistingByPhone) {
      const existingId = await findCandidateIdBySamePhone(tx, imp.pool.id, input.fields.phone);
      if (existingId) {
        await tx.candidateDocument.create({ data: { candidateId: existingId, ...document } });
        await closeImport(existingId);
        return { candidateId: existingId, row: null, attached: true };
      }
    }

    const row = await upsertCandidate(
      buildDashboardCandidateInput({
        pool: imp.pool,
        fields: input.fields,
        channel,
        consentToShare: input.consentToShare,
        rawPayload: {
          mode: channel === "landing_cv" ? "landing_cv" : "cv",
          importId: imp.id,
          createdById: input.userId,
          draft: imp.draft,
          submitted: input.fields,
          ...input.rawPayloadExtra,
        } as unknown as Prisma.InputJsonValue,
      }),
      tx,
    );

    await tx.candidateDocument.create({ data: { candidateId: row.id, ...document } });
    await closeImport(row.id);
    return { candidateId: row.id, row, attached: false };
  });

  if (result.row) await refreshCandidateEmbedding(result.row, "candidate import");
  return { candidateId: result.candidateId, attached: result.attached };
}

/** Discard an open import of the organization and delete its file. */
export async function discardImport(importId: string, organizationId: string): Promise<boolean> {
  if (!isUuid(importId)) return false;
  const imp = await prisma.candidateImport.findFirst({
    where: { id: importId, organizationId },
    select: { storagePath: true },
  });
  if (!imp) return false;

  const res = await prisma.candidateImport.updateMany({
    where: { id: importId, organizationId, status: { in: [...OPEN_STATUSES] } },
    data: { status: "DISCARDED", extractedText: null, draft: Prisma.DbNull },
  });
  if (res.count === 0) return false;

  try {
    await removeCandidateDocuments([imp.storagePath]);
  } catch (e) {
    console.error("[candidate import] file removal failed", { importId, error: e });
  }
  return true;
}

/**
 * Nightly cleanup: discard open imports untouched for 7 days and delete their
 * files (an open import never has a CandidateDocument). Returns the count.
 */
export async function discardStaleImports(now = new Date(), batchSize = 100): Promise<number> {
  const stale = await prisma.candidateImport.findMany({
    where: {
      status: { in: [...OPEN_STATUSES] },
      updatedAt: { lt: new Date(now.getTime() - STALE_IMPORT_MS) },
    },
    select: { id: true, storagePath: true },
    take: batchSize,
  });
  if (stale.length === 0) return 0;

  const res = await prisma.candidateImport.updateMany({
    where: { id: { in: stale.map((s) => s.id) }, status: { in: [...OPEN_STATUSES] } },
    data: { status: "DISCARDED", extractedText: null, draft: Prisma.DbNull },
  });
  const discarded = await prisma.candidateImport.findMany({
    where: { id: { in: stale.map((s) => s.id) }, status: "DISCARDED" },
    select: { storagePath: true },
  });
  try {
    await removeCandidateDocuments(discarded.map((d) => d.storagePath));
  } catch (e) {
    console.error("[candidate import] stale file removal failed", e);
  }
  return res.count;
}

/** Everything the review page needs, scoped to the organization. */
export async function getImportForOrg(importId: string, organizationId: string) {
  if (!isUuid(importId)) return null;
  return prisma.candidateImport.findFirst({
    where: { id: importId, organizationId },
    select: {
      id: true,
      status: true,
      errorCode: true,
      draft: true,
      extractedText: true,
      fileName: true,
      mimeType: true,
      storagePath: true,
      candidateId: true,
      poolId: true,
      updatedAt: true,
    },
  });
}
