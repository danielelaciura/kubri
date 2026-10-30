import { describe, it, expect, beforeEach, vi } from "vitest";

const bucket = {
  createSignedUploadUrl: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  remove: vi.fn(),
  upload: vi.fn(),
  list: vi.fn(),
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
  listDocumentObjects,
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

  it("listDocumentObjects walks pool and import folders and paginates", async () => {
    const folder = (name: string) => ({ name, id: null, created_at: null });
    const file = (name: string, created: string) => ({ name, id: `id-${name}`, created_at: created });
    const pageOfImports = Array.from({ length: 100 }, (_, i) => folder(`imp-${i}`));
    bucket.list.mockImplementation(async (prefix: string, opts: { limit: number; offset: number }) => {
      if (prefix === "") return { data: opts.offset === 0 ? [folder("pool-a")] : [], error: null };
      if (prefix === "pool-a") {
        if (opts.offset === 0) return { data: pageOfImports, error: null };
        if (opts.offset === 100) return { data: [folder("imp-last")], error: null };
        return { data: [], error: null };
      }
      if (prefix === "pool-a/imp-last") {
        return {
          data: [file("cv.pdf", "2026-10-01T00:00:00Z"), file(".emptyFolderPlaceholder", "2026-10-01T00:00:00Z")],
          error: null,
        };
      }
      return { data: [], error: null };
    });

    const objects = await listDocumentObjects();

    expect(objects).toEqual([
      { path: "pool-a/imp-last/cv.pdf", importId: "imp-last", createdAt: new Date("2026-10-01T00:00:00Z") },
    ]);
    expect(bucket.list).toHaveBeenCalledWith("pool-a", { limit: 100, offset: 0 });
    expect(bucket.list).toHaveBeenCalledWith("pool-a", { limit: 100, offset: 100 });
    // A short page ends the walk of a prefix.
    expect(bucket.list).not.toHaveBeenCalledWith("pool-a", { limit: 100, offset: 200 });
  });

  it("listDocumentObjects throws StorageError when a list fails", async () => {
    bucket.list.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(listDocumentObjects()).rejects.toBeInstanceOf(StorageError);
  });

  const folder = (name: string) => ({ name, id: null, created_at: null });
  const file = (name: string) => ({ name, id: `id-${name}`, created_at: "2026-10-01T00:00:00Z" });
  function bucketOf(pools: Record<string, string[]>) {
    bucket.list.mockImplementation(async (prefix: string, opts: { offset: number }) => {
      if (opts.offset > 0) return { data: [], error: null };
      if (prefix === "") return { data: Object.keys(pools).map(folder), error: null };
      if (prefix in pools) return { data: pools[prefix]!.map(folder), error: null };
      return { data: [file("cv.pdf")], error: null };
    });
  }
  const fileListCalls = () => bucket.list.mock.calls.filter(([p]) => String(p).split("/").length === 2);

  it("listDocumentObjects stops after maxImportFolders import folders", async () => {
    bucketOf({ a: ["i1", "i2"], b: ["i3", "i4"] });
    const objects = await listDocumentObjects({ maxImportFolders: 3, random: () => 0 });
    expect(objects.map((o) => o.importId)).toEqual(["i1", "i2", "i3"]);
    expect(fileListCalls()).toHaveLength(3);
  });

  it("listDocumentObjects stops at the deadline", async () => {
    bucketOf({ a: ["i1", "i2"] });
    const objects = await listDocumentObjects({ deadline: Date.now() - 1 });
    expect(objects).toEqual([]);
    expect(fileListCalls()).toHaveLength(0);
  });

  it("listDocumentObjects starts from a random pool and import so a capped sweep rotates", async () => {
    bucketOf({ a: ["i1", "i2"], b: ["i3", "i4"] });
    const objects = await listDocumentObjects({ maxImportFolders: 1, random: () => 0.5 });
    expect(objects.map((o) => o.importId)).toEqual(["i4"]);
  });
});
