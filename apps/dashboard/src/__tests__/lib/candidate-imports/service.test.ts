import { describe, it, expect, beforeEach, vi } from "vitest";

const tx = {
  candidateImport: { findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  candidateDocument: { create: vi.fn() },
  candidate: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({
  prisma: {
    candidateImport: {
      create: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: vi.fn() }));
vi.mock("@/lib/storage/candidate-documents", async () => {
  const actual = await vi.importActual<typeof import("@/lib/storage/candidate-documents")>(
    "@/lib/storage/candidate-documents",
  );
  return {
    ...actual,
    createDocumentUploadUrl: vi.fn(),
    downloadCandidateDocument: vi.fn(),
    removeCandidateDocuments: vi.fn(),
    replaceCandidateDocument: vi.fn(),
  };
});
vi.mock("@/lib/candidates/duplicates", () => ({ findCandidateIdBySamePhone: vi.fn() }));
vi.mock("@/lib/documents/inspect", () => ({ inspectPublicDocument: vi.fn() }));
vi.mock("@/lib/documents/extract-text", () => ({ extractDocumentText: vi.fn() }));
vi.mock("@/lib/candidates/cv-extraction", () => ({ extractCandidateDraft: vi.fn() }));
vi.mock("@/lib/candidates/ingest", () => ({
  upsertCandidate: vi.fn(),
  refreshCandidateEmbedding: vi.fn(),
}));

import { prisma } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import {
  createDocumentUploadUrl,
  downloadCandidateDocument,
  removeCandidateDocuments,
  replaceCandidateDocument,
} from "@/lib/storage/candidate-documents";
import { findCandidateIdBySamePhone } from "@/lib/candidates/duplicates";
import { inspectPublicDocument } from "@/lib/documents/inspect";
import { StorageError } from "@/lib/storage/errors";
import { extractDocumentText } from "@/lib/documents/extract-text";
import { extractCandidateDraft } from "@/lib/candidates/cv-extraction";
import { refreshCandidateEmbedding, upsertCandidate } from "@/lib/candidates/ingest";
import { LLMTimeoutError } from "@/lib/llm/errors";
import { ImportError, ImportStateError } from "@/lib/candidate-imports/errors";
import {
  confirmImport,
  createUploadTicket,
  discardImport,
  discardStaleImports,
  getImportForOrg,
  getPublicImport,
  registerUpload,
  runExtraction,
} from "@/lib/candidate-imports/service";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const PDF = new TextEncoder().encode("%PDF-1.7 fake");
const DRAFT = { isCv: true, fields: { firstName: "A" }, uncertain: [] };
const IMPORT_ID = "22222222-2222-2222-2222-222222222222";
const REGISTER = {
  importId: IMPORT_ID, organizationId: "o", poolId: "p", origin: "OPERATOR" as const,
  createdById: "u", fileName: "CV Ahmed.pdf",
};

describe("createUploadTicket", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects a declared size over the limit without touching storage", async () => {
    await expect(
      createUploadTicket({ poolId: "p", fileName: "cv.pdf", fileSize: 10 * 1024 * 1024 + 1 }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
    expect(m(createDocumentUploadUrl)).not.toHaveBeenCalled();
  });

  it("returns a fresh import id, a server-chosen path and the token", async () => {
    m(createDocumentUploadUrl).mockResolvedValueOnce({ token: "tok" });
    const t = await createUploadTicket({ poolId: "p", fileName: "CV Ahmed.pdf", fileSize: 1000 });
    expect(t.importId).toMatch(/^[0-9a-f-]{36}$/);
    expect(t.storagePath).toBe(`p/${t.importId}/CV_Ahmed.pdf`);
    expect(t.token).toBe("tok");
  });

  it("maps storage failures to STORAGE_ERROR", async () => {
    m(createDocumentUploadUrl).mockRejectedValueOnce(new StorageError("x"));
    await expect(
      createUploadTicket({ poolId: "p", fileName: "cv.pdf", fileSize: 1000 }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });
});

describe("registerUpload", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies the stored file and creates an UPLOADED import", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    await expect(registerUpload(REGISTER)).resolves.toEqual({ importId: IMPORT_ID });
    expect(m(downloadCandidateDocument)).toHaveBeenCalledWith(`p/${IMPORT_ID}/CV_Ahmed.pdf`);
    expect(m(prisma.candidateImport.create).mock.calls[0]![0].data).toMatchObject({
      id: IMPORT_ID, status: "UPLOADED", mimeType: "application/pdf", fileSize: PDF.byteLength,
      fileName: "CV Ahmed.pdf", origin: "OPERATOR", storagePath: `p/${IMPORT_ID}/CV_Ahmed.pdf`,
    });
  });

  it("deletes and rejects a file with the wrong magic bytes", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(new TextEncoder().encode("hello"));
    m(removeCandidateDocuments).mockResolvedValueOnce(undefined);
    await expect(registerUpload(REGISTER)).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    expect(m(removeCandidateDocuments)).toHaveBeenCalledWith([`p/${IMPORT_ID}/CV_Ahmed.pdf`]);
    expect(m(prisma.candidateImport.create)).not.toHaveBeenCalled();
  });

  it("deletes and rejects an oversize file", async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    big.set(PDF);
    m(downloadCandidateDocument).mockResolvedValueOnce(big);
    m(removeCandidateDocuments).mockResolvedValueOnce(undefined);
    await expect(registerUpload(REGISTER)).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("maps a missing object to STORAGE_ERROR", async () => {
    m(downloadCandidateDocument).mockRejectedValueOnce(new StorageError("not found"));
    await expect(registerUpload(REGISTER)).rejects.toMatchObject({ code: "STORAGE_ERROR" });
  });
});

describe("runExtraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("does nothing when the import cannot be claimed", async () => {
    m(prisma.candidateImport.updateMany).mockResolvedValueOnce({ count: 0 });
    await runExtraction("22222222-2222-4222-8222-222222222222");
    expect(m(downloadCandidateDocument)).not.toHaveBeenCalled();
  });

  it("claims, extracts and stores the draft as READY", async () => {
    m(prisma.candidateImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValueOnce({ storagePath: "p/i/cv.pdf" });
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(extractDocumentText).mockResolvedValueOnce({ text: "CV", method: "pdf", pageCount: 1 });
    m(extractCandidateDraft).mockResolvedValueOnce(DRAFT);

    await runExtraction("22222222-2222-4222-8222-222222222222");

    const claim = m(prisma.candidateImport.updateMany).mock.calls[0]![0];
    expect(claim.data.status).toBe("EXTRACTING");
    expect(claim.data.errorCode).toBeNull();
    const claimedAt = claim.data.updatedAt;
    expect(claimedAt).toBeInstanceOf(Date);
    const fin = m(prisma.candidateImport.updateMany).mock.calls[1]![0];
    expect(fin.where).toEqual({ id: "22222222-2222-4222-8222-222222222222", status: "EXTRACTING", updatedAt: claimedAt });
    expect(fin.data).toEqual({
      status: "READY", extractedText: "CV", extractionMethod: "pdf", draft: DRAFT, errorCode: null,
    });
    expect(m(prisma.candidateImport.update)).not.toHaveBeenCalled();
  });

  it("stores NOT_A_CV as a READY warning", async () => {
    m(prisma.candidateImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValueOnce({ storagePath: "x" });
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(extractDocumentText).mockResolvedValueOnce({ text: "fattura", method: "pdf", pageCount: 1 });
    m(extractCandidateDraft).mockResolvedValueOnce({ ...DRAFT, isCv: false });
    await runExtraction("22222222-2222-4222-8222-222222222222");
    expect(m(prisma.candidateImport.updateMany).mock.calls[1]![0].data).toMatchObject({
      status: "READY", errorCode: "NOT_A_CV",
    });
  });

  it("marks FAILED with a mapped code on error", async () => {
    m(prisma.candidateImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValueOnce({ storagePath: "x" });
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(extractDocumentText).mockResolvedValueOnce({ text: "CV", method: "pdf", pageCount: 1 });
    m(extractCandidateDraft).mockRejectedValueOnce(new LLMTimeoutError("t"));
    await runExtraction("22222222-2222-4222-8222-222222222222");
    const fin = m(prisma.candidateImport.updateMany).mock.calls[1]![0];
    expect(fin.where).toMatchObject({ id: "22222222-2222-4222-8222-222222222222", status: "EXTRACTING" });
    expect(fin.data).toEqual({ status: "FAILED", errorCode: "LLM_TIMEOUT" });
  });

  it("logs only the error message, never the cause chain (may hold CV data)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    m(prisma.candidateImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValueOnce({ storagePath: "x" });
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(extractDocumentText).mockResolvedValueOnce({ text: "CV", method: "pdf", pageCount: 1 });
    m(extractCandidateDraft).mockRejectedValueOnce(new LLMTimeoutError("t", new Error("Mario Rossi, via Roma 1")));
    await runExtraction("22222222-2222-4222-8222-222222222222");
    expect(err).toHaveBeenCalledWith("[candidate import] extraction failed", {
      importId: "22222222-2222-4222-8222-222222222222", code: "LLM_TIMEOUT", message: "t",
    });
  });

  it("drops the result without throwing when the import changed state", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m(prisma.candidateImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValueOnce({ storagePath: "x" });
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(extractDocumentText).mockResolvedValueOnce({ text: "CV", method: "pdf", pageCount: 1 });
    m(extractCandidateDraft).mockResolvedValueOnce(DRAFT);
    await expect(runExtraction("22222222-2222-4222-8222-222222222222")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      "[candidate import] extraction result dropped: import changed state",
      { importId: "22222222-2222-4222-8222-222222222222" },
    );
  });

  it("strips NUL characters from the extracted text", async () => {
    m(prisma.candidateImport.updateMany)
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValueOnce({ storagePath: "x" });
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(extractDocumentText).mockResolvedValueOnce({ text: "C\u0000V", method: "pdf", pageCount: 1 });
    m(extractCandidateDraft).mockResolvedValueOnce(DRAFT);
    await runExtraction("22222222-2222-4222-8222-222222222222");
    expect(m(extractCandidateDraft)).toHaveBeenCalledWith("CV");
    expect(m(prisma.candidateImport.updateMany).mock.calls[1]![0].data.extractedText).toBe("CV");
  });
});

describe("confirmImport", () => {
  const FIELDS = { firstName: "Ahmed", lastName: "Benali" } as never;
  const IMPORT = {
    id: "22222222-2222-4222-8222-222222222222", status: "READY", candidateId: null, storagePath: "p/22222222-2222-4222-8222-222222222222/cv.pdf",
    fileName: "cv.pdf", mimeType: "application/pdf", fileSize: 10, createdById: "u",
    draft: DRAFT, pool: { id: "p", isGlobal: false, globalSharing: "WEBHOOK" },
  };

  beforeEach(() => vi.clearAllMocks());

  it("creates candidate + document in one transaction, then embeds", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce(IMPORT);
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(upsertCandidate).mockResolvedValueOnce({ id: "c-1" });

    const r = await confirmImport({ importId: "22222222-2222-4222-8222-222222222222", organizationId: "o", userId: "u", fields: FIELDS });

    expect(r).toEqual({ candidateId: "c-1", attached: false });
    expect(tx.candidateImport.findFirst.mock.calls[0]![0].where).toEqual({ id: "22222222-2222-4222-8222-222222222222", organizationId: "o" });
    expect(tx.candidateImport.updateMany.mock.calls[0]![0]).toEqual({
      where: {
        id: "22222222-2222-4222-8222-222222222222",
        OR: [
          { status: { in: ["READY", "FAILED"] } },
          { status: "EXTRACTING", updatedAt: { lt: expect.any(Date) } },
        ],
      },
      data: { status: "COMPLETED" },
    });
    const [data, client] = m(upsertCandidate).mock.calls[0]!;
    expect(data.channel).toBe("dashboard_cv");
    expect(data.rawPayload).toMatchObject({ mode: "cv", importId: "22222222-2222-4222-8222-222222222222", draft: DRAFT, submitted: FIELDS });
    expect(client).toBe(tx);
    expect(tx.candidateDocument.create.mock.calls[0]![0].data).toMatchObject({
      candidateId: "c-1", kind: "CV", storagePath: "p/22222222-2222-4222-8222-222222222222/cv.pdf",
    });
    expect(tx.candidateImport.update.mock.calls[0]![0].data).toEqual({
      candidateId: "c-1", extractedText: null, draft: Prisma.DbNull,
    });
    expect(m(refreshCandidateEmbedding)).toHaveBeenCalledWith({ id: "c-1" }, "candidate import");
  });

  it("can confirm a stale EXTRACTING import (manual fallback)", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce({ ...IMPORT, status: "EXTRACTING" });
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(upsertCandidate).mockResolvedValueOnce({ id: "c-2" });
    const r = await confirmImport({ importId: "22222222-2222-4222-8222-222222222222", organizationId: "o", userId: "u", fields: FIELDS });
    expect(r).toEqual({ candidateId: "c-2", attached: false });
    const where = tx.candidateImport.updateMany.mock.calls[0]![0].where;
    const stale = where.OR[1].updatedAt.lt as Date;
    expect(Date.now() - stale.getTime()).toBeGreaterThanOrEqual(2 * 60 * 1000 - 50);
  });

  it("is idempotent for an already completed import", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce({ ...IMPORT, status: "COMPLETED", candidateId: "c-9" });
    const r = await confirmImport({ importId: "22222222-2222-4222-8222-222222222222", organizationId: "o", userId: "u", fields: FIELDS });
    expect(r).toEqual({ candidateId: "c-9", attached: false });
    expect(m(upsertCandidate)).not.toHaveBeenCalled();
  });

  it("throws ImportStateError when the import lost the race", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce(IMPORT);
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      confirmImport({ importId: "22222222-2222-4222-8222-222222222222", organizationId: "o", userId: "u", fields: FIELDS }),
    ).rejects.toBeInstanceOf(ImportStateError);
  });

  it("does not find another org's import", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce(null);
    await expect(
      confirmImport({ importId: "22222222-2222-4222-8222-222222222222", organizationId: "other", userId: "u", fields: FIELDS }),
    ).rejects.toThrow();
  });
  it("public mode attaches the CV to the same-phone candidate of the pool", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce({ ...IMPORT, createdById: null });
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(findCandidateIdBySamePhone).mockResolvedValueOnce("c-existing");

    const r = await confirmImport({
      importId: IMPORT.id, organizationId: "o", userId: null,
      fields: { firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567" } as never,
      channel: "landing_cv", attachToExistingByPhone: true,
    });

    expect(r).toEqual({ candidateId: "c-existing", attached: true });
    expect(m(findCandidateIdBySamePhone)).toHaveBeenCalledWith(tx, "p", "+39 333 1234567");
    expect(m(upsertCandidate)).not.toHaveBeenCalled();
    expect(tx.candidateDocument.create.mock.calls[0]![0].data).toMatchObject({
      candidateId: "c-existing", kind: "CV", uploadedById: null,
    });
    expect(tx.candidateImport.update.mock.calls[0]![0].data).toMatchObject({ candidateId: "c-existing" });
    expect(m(refreshCandidateEmbedding)).not.toHaveBeenCalled();
  });

  it("public mode creates a landing candidate when no phone matches", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce({ ...IMPORT, createdById: null });
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(findCandidateIdBySamePhone).mockResolvedValueOnce(null);
    m(upsertCandidate).mockResolvedValueOnce({ id: "c-new" });

    const r = await confirmImport({
      importId: IMPORT.id, organizationId: "o", userId: null,
      fields: { firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567" } as never,
      channel: "landing_cv", consentToShare: true, attachToExistingByPhone: true,
      rawPayloadExtra: { landingPageId: "l-1", consent: { acceptedAt: "t" } },
    });

    expect(r).toEqual({ candidateId: "c-new", attached: false });
    const [data] = m(upsertCandidate).mock.calls[0]!;
    expect(data.channel).toBe("landing_cv");
    expect(data.externalId).toMatch(/^landing:/);
    expect(data.sharedWithGlobal).toBe(true);
    expect(data.rawPayload).toMatchObject({
      mode: "landing_cv", createdById: null, landingPageId: "l-1", consent: { acceptedAt: "t" },
    });
  });

  it("operator mode never looks up phones", async () => {
    tx.candidateImport.findFirst.mockResolvedValueOnce(IMPORT);
    tx.candidateImport.updateMany.mockResolvedValueOnce({ count: 1 });
    m(upsertCandidate).mockResolvedValueOnce({ id: "c-1" });
    await confirmImport({ importId: IMPORT.id, organizationId: "o", userId: "u", fields: FIELDS });
    expect(m(findCandidateIdBySamePhone)).not.toHaveBeenCalled();
  });
});

describe("discardImport / discardStaleImports", () => {
  beforeEach(() => vi.clearAllMocks());

  it("discards an open import of the org and removes its file", async () => {
    m(prisma.candidateImport.findFirst).mockResolvedValueOnce({ storagePath: "p/i/cv.pdf" });
    m(prisma.candidateImport.updateMany).mockResolvedValueOnce({ count: 1 });
    await expect(discardImport("22222222-2222-4222-8222-222222222222", "o")).resolves.toBe(true);
    expect(m(prisma.candidateImport.updateMany).mock.calls[0]![0].where).toEqual({
      id: "22222222-2222-4222-8222-222222222222", organizationId: "o", status: { in: ["UPLOADED", "EXTRACTING", "READY", "FAILED"] },
    });
    expect(m(prisma.candidateImport.updateMany).mock.calls[0]![0].data).toEqual({
      status: "DISCARDED", extractedText: null, draft: Prisma.DbNull,
    });
    expect(m(removeCandidateDocuments)).toHaveBeenCalledWith(["p/i/cv.pdf"]);
  });

  it("discards stale open imports older than 7 days", async () => {
    const now = new Date("2026-10-23T03:00:00Z");
    m(prisma.candidateImport.findMany).mockResolvedValueOnce([
      { id: "a", storagePath: "p/a/cv.pdf" },
      { id: "b", storagePath: "p/b/cv.pdf" },
    ]);
    m(prisma.candidateImport.updateMany).mockResolvedValueOnce({ count: 2 });
    m(prisma.candidateImport.findMany).mockResolvedValueOnce([
      { storagePath: "p/a/cv.pdf" },
      { storagePath: "p/b/cv.pdf" },
    ]);
    await expect(discardStaleImports(now)).resolves.toBe(2);
    const where = m(prisma.candidateImport.findMany).mock.calls[0]![0].where;
    expect(where).toEqual({
      status: { in: ["UPLOADED", "EXTRACTING", "READY", "FAILED"] },
      OR: [
        { updatedAt: { lt: new Date("2026-10-16T03:00:00Z") } },
        { origin: "PUBLIC_LINK", updatedAt: { lt: new Date("2026-10-22T03:00:00Z") } },
      ],
    });
    expect(m(prisma.candidateImport.updateMany).mock.calls[0]![0].data).toEqual({
      status: "DISCARDED", extractedText: null, draft: Prisma.DbNull,
    });
    expect(m(removeCandidateDocuments)).toHaveBeenCalledWith(["p/a/cv.pdf", "p/b/cv.pdf"]);
  });
});

it("removes files only for rows actually discarded", async () => {
  m(prisma.candidateImport.findMany)
    .mockResolvedValueOnce([
      { id: "a", storagePath: "p/a/cv.pdf" },
      { id: "b", storagePath: "p/b/cv.pdf" },
    ])
    .mockResolvedValueOnce([{ storagePath: "p/a/cv.pdf" }]);
  m(prisma.candidateImport.updateMany).mockResolvedValueOnce({ count: 1 });
  m(removeCandidateDocuments).mockClear();
  await expect(discardStaleImports(new Date())).resolves.toBe(1);
  expect(m(prisma.candidateImport.findMany).mock.calls[1]![0]).toEqual({
    where: { id: { in: ["a", "b"] }, status: "DISCARDED" },
    select: { storagePath: true },
  });
  expect(m(removeCandidateDocuments)).toHaveBeenCalledWith(["p/a/cv.pdf"]);
});

it("ImportError carries its code", () => {
  expect(new ImportError("NO_TEXT").code).toBe("NO_TEXT");
});

describe("non-UUID import ids never reach the database", () => {
  const bad = [{ not: "x" } as never, "abc" as never];
  beforeEach(() => vi.clearAllMocks());

  it("getImportForOrg returns null", async () => {
    for (const id of bad) await expect(getImportForOrg(id, "o")).resolves.toBeNull();
    expect(prisma.candidateImport.findFirst).not.toHaveBeenCalled();
  });
  it("discardImport returns false", async () => {
    for (const id of bad) await expect(discardImport(id, "o")).resolves.toBe(false);
    expect(prisma.candidateImport.findFirst).not.toHaveBeenCalled();
    expect(prisma.candidateImport.updateMany).not.toHaveBeenCalled();
  });
  it("runExtraction returns early", async () => {
    for (const id of bad) await expect(runExtraction(id)).resolves.toBeUndefined();
    expect(prisma.candidateImport.updateMany).not.toHaveBeenCalled();
  });
});

describe("public upload options", () => {
  beforeEach(() => vi.clearAllMocks());

  it("createUploadTicket honours a lower maxBytes", async () => {
    await expect(
      createUploadTicket({ poolId: "p", fileName: "cv.pdf", fileSize: 6 * 1024 * 1024, maxBytes: 5 * 1024 * 1024 }),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("registerUpload with inspect rejects and removes an unsafe file", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    m(inspectPublicDocument).mockResolvedValueOnce({ ok: false, reason: "pdf_active_content" });
    await expect(
      registerUpload({ ...REGISTER, origin: "PUBLIC_LINK", createdById: null, inspect: true }),
    ).rejects.toMatchObject({ code: "REJECTED_FILE" });
    expect(m(removeCandidateDocuments)).toHaveBeenCalledWith([`p/${IMPORT_ID}/CV_Ahmed.pdf`]);
    expect(m(prisma.candidateImport.create)).not.toHaveBeenCalled();
  });

  it("registerUpload with inspect stores re-encoded bytes and their type", async () => {
    const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
    const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 1, 2]);
    m(downloadCandidateDocument).mockResolvedValueOnce(PNG);
    m(inspectPublicDocument).mockResolvedValueOnce({ ok: true, bytes: JPEG, kind: "jpeg" });
    await registerUpload({ ...REGISTER, fileName: "foto.png", origin: "PUBLIC_LINK", createdById: null, inspect: true });
    expect(m(replaceCandidateDocument)).toHaveBeenCalledWith(`p/${IMPORT_ID}/foto.png`, JPEG, "image/jpeg");
    expect(m(prisma.candidateImport.create).mock.calls[0]![0].data).toMatchObject({
      origin: "PUBLIC_LINK", createdById: null, mimeType: "image/jpeg", fileSize: 5,
    });
  });

  it("registerUpload without inspect never calls the inspector", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(PDF);
    await registerUpload(REGISTER);
    expect(m(inspectPublicDocument)).not.toHaveBeenCalled();
  });

  it("registerUpload honours maxBytes on the stored object", async () => {
    m(downloadCandidateDocument).mockResolvedValueOnce(new Uint8Array(11));
    await expect(registerUpload({ ...REGISTER, maxBytes: 10 })).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });
});

describe("runExtraction public options", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m(prisma.candidateImport.updateMany).mockResolvedValue({ count: 1 });
    m(prisma.candidateImport.findUniqueOrThrow).mockResolvedValue({ storagePath: "p/i/cv.pdf" });
    m(downloadCandidateDocument).mockResolvedValue(PDF);
    m(extractDocumentText).mockResolvedValue({ text: "testo del cv", method: "pdf", pageCount: 1 });
  });

  it("passes maxOcrPages to text extraction", async () => {
    m(extractCandidateDraft).mockResolvedValueOnce(DRAFT);
    await runExtraction(IMPORT_ID, { maxOcrPages: 3 });
    expect(m(extractDocumentText)).toHaveBeenCalledWith(PDF, "pdf", { maxOcrPages: 3 });
  });

  it("fails NOT_A_CV without calling the LLM when the text gate says no", async () => {
    await runExtraction(IMPORT_ID, { textGate: () => false });
    expect(m(extractCandidateDraft)).not.toHaveBeenCalled();
    const finish = m(prisma.candidateImport.updateMany).mock.calls[1]![0];
    expect(finish.data).toEqual({ status: "FAILED", errorCode: "NOT_A_CV" });
  });

  it("rejectNonCv turns isCv=false into FAILED and keeps no text", async () => {
    m(extractCandidateDraft).mockResolvedValueOnce({ ...DRAFT, isCv: false });
    await runExtraction(IMPORT_ID, { rejectNonCv: true });
    const finish = m(prisma.candidateImport.updateMany).mock.calls[1]![0];
    expect(finish.data).toEqual({ status: "FAILED", errorCode: "NOT_A_CV" });
  });
});

describe("getPublicImport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("scopes by pool and PUBLIC_LINK origin", async () => {
    m(prisma.candidateImport.findFirst).mockResolvedValueOnce({ id: IMPORT_ID });
    await getPublicImport(IMPORT_ID, "p");
    expect(m(prisma.candidateImport.findFirst).mock.calls[0]![0]).toEqual({
      where: { id: IMPORT_ID, poolId: "p", origin: "PUBLIC_LINK" },
      select: { id: true, status: true, errorCode: true, draft: true },
    });
  });

  it("returns null for a non-UUID id", async () => {
    await expect(getPublicImport("x", "p")).resolves.toBeNull();
    expect(m(prisma.candidateImport.findFirst)).not.toHaveBeenCalled();
  });
});
