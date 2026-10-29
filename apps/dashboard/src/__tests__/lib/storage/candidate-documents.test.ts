import { describe, it, expect, beforeEach, vi } from "vitest";

const bucket = {
  createSignedUploadUrl: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
};
const from = vi.fn(() => bucket);

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({ storage: { from } }),
}));

import {
  buildDocumentPath,
  createDocumentSignedUrl,
  createDocumentUploadUrl,
  downloadCandidateDocument,
  removeCandidateDocuments,
  replaceCandidateDocument,
  sanitizeFileName,
  StorageError,
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
    expect(sanitizeFileName("../../etc/passwd")).toBe("_.._etc_passwd");
    for (const n of ["..", ".", "...", "???"]) expect(sanitizeFileName(n)).toBe("document");
    expect(sanitizeFileName(".bashrc")).toBe("bashrc");
    expect(sanitizeFileName("")).toBe("document");
    expect(sanitizeFileName("à".repeat(300)).length).toBeLessThanOrEqual(100);
  });

  it("builds pool/import scoped paths", () => {
    expect(buildDocumentPath("pool-1", "imp-1", "cv.pdf")).toBe("pool-1/imp-1/cv.pdf");
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

  it("replaceCandidateDocument overwrites the object with the given type", async () => {
    bucket.upload.mockResolvedValueOnce({ data: { path: "p/i/cv.png" }, error: null });
    await replaceCandidateDocument("p/i/cv.png", new Uint8Array([1]), "image/jpeg");
    expect(bucket.upload).toHaveBeenCalledWith("p/i/cv.png", new Uint8Array([1]), {
      upsert: true,
      contentType: "image/jpeg",
    });
  });

  it("replaceCandidateDocument throws StorageError on failure", async () => {
    bucket.upload.mockResolvedValueOnce({ data: null, error: { message: "nope" } });
    await expect(
      replaceCandidateDocument("p/i/cv.png", new Uint8Array([1]), "image/jpeg"),
    ).rejects.toBeInstanceOf(StorageError);
  });
});
