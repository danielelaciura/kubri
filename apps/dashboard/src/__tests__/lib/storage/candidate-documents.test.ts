import { describe, it, expect, beforeEach, vi } from "vitest";

const bucket = {
  upload: vi.fn(),
  createSignedUploadUrl: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
};
const from = vi.fn(() => bucket);

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from } }),
}));

import {
  CANDIDATE_DOCUMENTS_BUCKET,
  StorageError,
  buildDocumentPath,
  createDocumentSignedUrl,
  createDocumentUploadUrl,
  downloadCandidateDocument,
  removeCandidateDocuments,
  sanitizeFileName,
  uploadCandidateDocument,
} from "@/lib/storage/candidate-documents";

describe("candidate-documents storage", () => {
  it("creates a signed upload token for a path", async () => {
    bucket.createSignedUploadUrl.mockResolvedValueOnce({
      data: { signedUrl: "https://u", token: "tok", path: "p/i/cv.pdf" },
      error: null,
    });
    await expect(createDocumentUploadUrl("p/i/cv.pdf")).resolves.toEqual({ token: "tok" });
    expect(bucket.createSignedUploadUrl).toHaveBeenCalledWith("p/i/cv.pdf");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sanitizes file names", () => {
    expect(sanitizeFileName("CV Ahmed Benali (2024).pdf")).toBe("CV_Ahmed_Benali_2024_.pdf");
    expect(sanitizeFileName("../../etc/passwd")).toBe(".._.._etc_passwd");
    expect(sanitizeFileName("???")).toBe("_");
    expect(sanitizeFileName("")).toBe("document");
    expect(sanitizeFileName("à".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("builds pool/import scoped paths", () => {
    expect(buildDocumentPath("pool-1", "imp-1", "cv.pdf")).toBe("pool-1/imp-1/cv.pdf");
  });

  it("uploads with content type and no upsert", async () => {
    bucket.upload.mockResolvedValueOnce({ data: {}, error: null });
    await uploadCandidateDocument("p/i/cv.pdf", new Uint8Array([1]), "application/pdf");
    expect(from).toHaveBeenCalledWith(CANDIDATE_DOCUMENTS_BUCKET);
    expect(bucket.upload).toHaveBeenCalledWith("p/i/cv.pdf", expect.any(Uint8Array), {
      contentType: "application/pdf",
      upsert: false,
    });
  });

  it("wraps Supabase errors in StorageError", async () => {
    bucket.upload.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(
      uploadCandidateDocument("p", new Uint8Array([1]), "application/pdf"),
    ).rejects.toBeInstanceOf(StorageError);
  });

  it("downloads as bytes", async () => {
    bucket.download.mockResolvedValueOnce({ data: new Blob([new Uint8Array([7, 8])]), error: null });
    expect(Array.from(await downloadCandidateDocument("p"))).toEqual([7, 8]);
  });

  it("creates a 60s signed URL by default", async () => {
    bucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://x" }, error: null });
    await expect(createDocumentSignedUrl("p")).resolves.toBe("https://x");
    expect(bucket.createSignedUrl).toHaveBeenCalledWith("p", 60, undefined);
  });

  it("passes a download file name when asked", async () => {
    bucket.createSignedUrl.mockResolvedValueOnce({ data: { signedUrl: "https://x" }, error: null });
    await createDocumentSignedUrl("p", { downloadAs: "cv.pdf" });
    expect(bucket.createSignedUrl).toHaveBeenCalledWith("p", 60, { download: "cv.pdf" });
  });

  it("removes nothing for an empty list", async () => {
    await removeCandidateDocuments([]);
    expect(bucket.remove).not.toHaveBeenCalled();
  });
});
