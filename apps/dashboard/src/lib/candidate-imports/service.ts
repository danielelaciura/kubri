import { createHash, randomUUID } from "node:crypto";
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
  listDocumentObjects,
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
export const STALE_EXTRACTION_MS = 2 * 60 * 1000;
/** Open imports untouched for this long are discarded by the nightly cron. */
const STALE_IMPORT_MS = 7 * 24 * 60 * 60 * 1000;
/** Public uploads without consent must not linger: discard after 24 h. */
const STALE_PUBLIC_IMPORT_MS = 24 * 60 * 60 * 1000;
/** Uploaded objects with no CandidateImport row after this long are orphans. */
const ORPHAN_UPLOAD_MS = 24 * 60 * 60 * 1000;
/** Upper bound on stale-import batches per cron run. */
const MAX_STALE_BATCHES = 20;
/** Chunk size for id lookups and storage removals in the orphan sweep. */
const ORPHAN_CHUNK = 100;
/** Operator paths never see landing uploads (those belong to the public flow). */
const NOT_PUBLIC = { not: "PUBLIC_LINK" } as const;
/** A discarded import keeps no extracted text, draft or original file name (GDPR). */
const DISCARDED_DATA = {
  status: "DISCARDED",
  extractedText: null,
  draft: Prisma.DbNull,
  fileName: "discarded",
} satisfies Prisma.CandidateImportUpdateManyMutationInput;
const OPEN_STATUSES = ["UPLOADED", "EXTRACTING", "READY", "FAILED"] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Server-action arguments are untrusted: an object here would become a Prisma operator. */
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Hex SHA-256 of the stored bytes: detects the object changing after registration. */
const sha256Hex = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

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

const KIND_EXTENSION: Record<DocumentKind, string> = {
  pdf: ".pdf",
  docx: ".docx",
  jpeg: ".jpg",
  png: ".png",
};

const MAX_FILE_NAME = 255;

/**
 * `name` with its extension rewritten to match `kind`, capped at 255 chars by
 * truncating the stem so the extension always survives.
 */
function withExtension(name: string, kind: DocumentKind): string {
  const ext = KIND_EXTENSION[kind];
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  return `${stem.slice(0, MAX_FILE_NAME - ext.length)}${ext}`;
}

/** Error name + message only: storage errors can carry paths (which hold file names). */
const errorSummary = (e: unknown) =>
  e instanceof Error ? { error: e.name, message: e.message } : { error: String(e) };

async function removeQuietly(storagePath: string, importId: string, why: string): Promise<void> {
  try {
    await removeCandidateDocuments([storagePath]);
  } catch (e) {
    console.error(`[candidate import] ${why} removal failed`, { importId, ...errorSummary(e) });
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

  // Re-registering must not touch storage (and used to surface as a raw P2002).
  const existing = await prisma.candidateImport.findUnique({
    where: { id: input.importId },
    select: { id: true },
  });
  if (existing) throw new ImportStateError("UPLOADED");

  let bytes: Uint8Array;
  try {
    bytes = await downloadCandidateDocument(storagePath);
  } catch (e) {
    throw new ImportError("STORAGE_ERROR", e);
  }

  const tooLarge = bytes.byteLength > (input.maxBytes ?? MAX_DOCUMENT_BYTES);
  const detected = tooLarge ? null : detectDocumentKind(bytes);
  if (!detected) {
    await removeQuietly(storagePath, input.importId, "invalid upload");
    throw new ImportError(tooLarge ? "FILE_TOO_LARGE" : "UNSUPPORTED_TYPE");
  }

  let stored = bytes;
  let kind: DocumentKind = detected;
  if (input.inspect) {
    const inspected = await inspectPublicDocument(bytes, detected);
    if (!inspected.ok) {
      console.warn("[candidate import] public upload rejected", { reason: inspected.reason });
      await removeQuietly(storagePath, input.importId, "rejected upload");
      throw new ImportError("REJECTED_FILE");
    }
    // Always re-upload so the stored Content-Type is the server's, never the browser's.
    try {
      await replaceCandidateDocument(storagePath, inspected.bytes, DOCUMENT_MIME[inspected.kind]);
    } catch (e) {
      await removeQuietly(storagePath, input.importId, "unreplaceable upload");
      throw new ImportError("STORAGE_ERROR", e);
    }
    stored = inspected.bytes;
    kind = inspected.kind;
  }

  try {
    await prisma.candidateImport.create({
      data: {
        id: input.importId,
        organizationId: input.organizationId,
        poolId: input.poolId,
        origin: input.origin,
        status: "UPLOADED",
        createdById: input.createdById,
        storagePath,
        fileName: input.inspect ? withExtension(input.fileName, kind) : input.fileName.slice(0, MAX_FILE_NAME),
        mimeType: DOCUMENT_MIME[kind],
        fileSize: stored.byteLength,
        contentSha256: sha256Hex(stored),
      },
    });
  } catch (e) {
    // Concurrent double register: the other call owns the file and the row.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ImportStateError("UPLOADED");
    }
    throw e;
  }
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
    select: { storagePath: true, contentSha256: true },
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
    if (imp.contentSha256 && sha256Hex(bytes) !== imp.contentSha256) {
      // The object changed after it was verified at registration: tampered.
      console.warn("[candidate import] stored file changed since registration", { importId });
      await finish({ status: "FAILED", errorCode: "REJECTED_FILE" });
      await removeQuietly(imp.storagePath, importId, "tampered upload");
      return;
    }
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
  /** Required for the public landing: the import must belong to this pool. */
  poolId?: string;
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
  /**
   * Written in the same transaction as the candidate/document (public landing:
   * the consent proof must exist iff the confirm committed). The metadata is
   * extended with candidateId, attached and documentId. Not written on the
   * idempotent re-confirm of a COMPLETED import.
   */
  audit?: { action: string; organizationId: string; metadata: Record<string, unknown> };
}

export interface ConfirmImportResult {
  candidateId: string;
  /** True when the CV was attached to an existing candidate. */
  attached: boolean;
  /** The CandidateDocument created for the CV (for the caller's audit row). */
  documentId: string | null;
}

/**
 * Create the candidate from a READY import (or a FAILED one filled in by
 * hand) — or attach the CV to an existing same-phone candidate — atomically.
 * Idempotent: confirming a COMPLETED import returns its candidate. Throws
 * ImportNotFoundError (wrong org / id) or ImportStateError (discarded, or lost
 * a concurrent confirm).
 *
 * The public landing (`channel: "landing_cv"`) is stricter: it requires
 * `poolId`, only matches PUBLIC_LINK imports of that pool and only claims READY
 * ones. On attach the consent is NOT stored on the candidate's rawPayload (the
 * existing profile is untouched): it lives in the caller's audit log, keyed by
 * the returned `documentId`.
 */
export async function confirmImport(input: ConfirmImportInput): Promise<ConfirmImportResult> {
  const channel = input.channel ?? "dashboard_cv";
  const isPublic = channel === "landing_cv";
  if (isPublic && !input.poolId) throw new ImportNotFoundError();
  const result = await prisma.$transaction(async (tx) => {
    const imp = await tx.candidateImport.findFirst({
      where: isPublic
        ? { id: input.importId, organizationId: input.organizationId, poolId: input.poolId, origin: "PUBLIC_LINK" }
        : { id: input.importId, organizationId: input.organizationId, origin: NOT_PUBLIC },
      include: { pool: true },
    });
    if (!imp) throw new ImportNotFoundError();
    if (imp.status === "COMPLETED" && imp.candidateId) {
      const doc = await tx.candidateDocument.findFirst({
        where: { candidateId: imp.candidateId, storagePath: imp.storagePath },
        select: { id: true },
      });
      return { candidateId: imp.candidateId, row: null, attached: false, documentId: doc?.id ?? null };
    }

    const claimed = await tx.candidateImport.updateMany({
      where: isPublic
        ? { id: imp.id, status: "READY" }
        : {
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

    // Public uploads: the file must still be the one verified at registration.
    // A mismatch throws and rolls the whole confirm back.
    if (isPublic && imp.contentSha256) {
      let bytes: Uint8Array;
      try {
        bytes = await downloadCandidateDocument(imp.storagePath);
      } catch (e) {
        throw new ImportError("STORAGE_ERROR", e);
      }
      if (sha256Hex(bytes) !== imp.contentSha256) {
        console.warn("[candidate import] stored file changed since registration", { importId: imp.id });
        throw new ImportError("REJECTED_FILE");
      }
    }

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
    const writeAudit = async (candidateId: string, attached: boolean, documentId: string) => {
      if (!input.audit) return;
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          organizationId: input.audit.organizationId,
          action: input.audit.action,
          resourceType: "candidate_import",
          resourceId: imp.id,
          metadata: { ...input.audit.metadata, candidateId, attached, documentId } as Prisma.InputJsonValue,
        },
      });
    };

    if (input.attachToExistingByPhone) {
      const existingId = await findCandidateIdBySamePhone(tx, imp.pool.id, input.fields.phone);
      if (existingId) {
        const doc = await tx.candidateDocument.create({
          data: { candidateId: existingId, ...document },
          select: { id: true },
        });
        await closeImport(existingId);
        await writeAudit(existingId, true, doc.id);
        return { candidateId: existingId, row: null, attached: true, documentId: doc.id };
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

    const doc = await tx.candidateDocument.create({
      data: { candidateId: row.id, ...document },
      select: { id: true },
    });
    await closeImport(row.id);
    await writeAudit(row.id, false, doc.id);
    return { candidateId: row.id, row, attached: false, documentId: doc.id };
    // Headroom over the 5 s default for the public integrity re-download.
  }, { timeout: 15_000 });

  if (result.row) await refreshCandidateEmbedding(result.row, "candidate import");
  return { candidateId: result.candidateId, attached: result.attached, documentId: result.documentId };
}

/** Discard an open operator import of the organization and delete its file. */
export async function discardImport(importId: string, organizationId: string): Promise<boolean> {
  if (!isUuid(importId)) return false;
  const imp = await prisma.candidateImport.findFirst({
    where: { id: importId, organizationId, origin: NOT_PUBLIC },
    select: { storagePath: true },
  });
  if (!imp) return false;

  const res = await prisma.candidateImport.updateMany({
    where: { id: importId, organizationId, origin: NOT_PUBLIC, status: { in: [...OPEN_STATUSES] } },
    data: DISCARDED_DATA,
  });
  if (res.count === 0) return false;

  try {
    await removeCandidateDocuments([imp.storagePath]);
  } catch (e) {
    console.error("[candidate import] file removal failed", { importId, ...errorSummary(e) });
  }
  return true;
}

/**
 * Nightly cleanup: discard open imports untouched for 7 days (24 h for public
 * uploads) and delete their files (an open import never has a CandidateDocument).
 * Loops batches until one comes back short, at most MAX_STALE_BATCHES per run.
 * Returns the total discarded.
 */
export async function discardStaleImports(now = new Date(), batchSize = 100): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_STALE_BATCHES; i++) {
    const stale = await prisma.candidateImport.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        OR: [
          { updatedAt: { lt: new Date(now.getTime() - STALE_IMPORT_MS) } },
          { origin: "PUBLIC_LINK", updatedAt: { lt: new Date(now.getTime() - STALE_PUBLIC_IMPORT_MS) } },
        ],
      },
      select: { id: true, storagePath: true },
      take: batchSize,
    });
    if (stale.length === 0) break;

    const res = await prisma.candidateImport.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: { in: [...OPEN_STATUSES] } },
      data: DISCARDED_DATA,
    });
    const discarded = await prisma.candidateImport.findMany({
      where: { id: { in: stale.map((s) => s.id) }, status: "DISCARDED" },
      select: { storagePath: true },
    });
    try {
      await removeCandidateDocuments(discarded.map((d) => d.storagePath));
    } catch (e) {
      console.error("[candidate import] stale file removal failed", errorSummary(e));
    }
    total += res.count;
    if (stale.length < batchSize) break;
  }
  return total;
}

/**
 * Nightly cleanup of uploads that were never registered: a ticket writes no
 * DB row, so an object whose import id has no CandidateImport row after
 * `maxAgeMs` is an orphan. Objects referenced by a CandidateDocument are
 * never touched. Returns the number of objects removed.
 */
export async function removeOrphanUploads(now = new Date(), maxAgeMs = ORPHAN_UPLOAD_MS): Promise<number> {
  const cutoff = now.getTime() - maxAgeMs;
  const old = (await listDocumentObjects()).filter(
    (o) => o.createdAt !== null && o.createdAt.getTime() < cutoff && isUuid(o.importId),
  );
  if (old.length === 0) return 0;

  const orphans: string[] = [];
  for (let i = 0; i < old.length; i += ORPHAN_CHUNK) {
    const chunk = old.slice(i, i + ORPHAN_CHUNK);
    const known = await prisma.candidateImport.findMany({
      where: { id: { in: [...new Set(chunk.map((o) => o.importId))] } },
      select: { id: true },
    });
    const knownIds = new Set(known.map((k) => k.id));
    const candidates = chunk.filter((o) => !knownIds.has(o.importId)).map((o) => o.path);
    if (candidates.length === 0) continue;
    // Defensive: a document whose import row is gone (e.g. org deleted) keeps its file.
    const attached = await prisma.candidateDocument.findMany({
      where: { storagePath: { in: candidates } },
      select: { storagePath: true },
    });
    const attachedPaths = new Set(attached.map((a) => a.storagePath));
    orphans.push(...candidates.filter((p) => !attachedPaths.has(p)));
  }

  let removed = 0;
  for (let i = 0; i < orphans.length; i += ORPHAN_CHUNK) {
    const batch = orphans.slice(i, i + ORPHAN_CHUNK);
    try {
      await removeCandidateDocuments(batch);
      removed += batch.length;
    } catch (e) {
      console.error("[candidate import] orphan upload removal failed", {
        count: batch.length,
        ...errorSummary(e),
      });
    }
  }
  return removed;
}

/** Everything the review page needs, scoped to the organization (operator imports only). */
export async function getImportForOrg(importId: string, organizationId: string) {
  if (!isUuid(importId)) return null;
  return prisma.candidateImport.findFirst({
    where: { id: importId, organizationId, origin: NOT_PUBLIC },
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

/** A public-landing import, scoped to the landing's pool. */
export async function getPublicImport(importId: string, poolId: string) {
  if (!isUuid(importId)) return null;
  return prisma.candidateImport.findFirst({
    where: { id: importId, poolId, origin: "PUBLIC_LINK" },
    select: { id: true, status: true, errorCode: true, draft: true, updatedAt: true },
  });
}
