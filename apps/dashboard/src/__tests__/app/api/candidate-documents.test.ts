import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({ requireOrganization: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/pools/access", () => ({ getOrgCandidateVisibility: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/candidate-imports/service", () => ({ getImportForOrg: vi.fn() }));
vi.mock("@/lib/storage/candidate-documents", () => ({ createDocumentSignedUrl: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: { candidateDocument: { findFirst: vi.fn() } },
}));

import { requireOrganization } from "@/lib/auth-utils";
import { logAudit } from "@/lib/audit";
import { getImportForOrg } from "@/lib/candidate-imports/service";
import { createDocumentSignedUrl } from "@/lib/storage/candidate-documents";
import { prisma } from "@/lib/db";
import { GET as previewGET } from "@/app/api/candidate-imports/[importId]/file/route";
import { GET as downloadGET } from "@/app/api/candidates/[id]/documents/[documentId]/route";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const req = new Request("http://localhost/x");

beforeEach(() => {
  vi.clearAllMocks();
  m(requireOrganization).mockResolvedValue({ id: "u", organizationId: "o", role: "ORG_MEMBER" });
  m(createDocumentSignedUrl).mockResolvedValue("https://signed.example/f?token=1");
});

describe("GET /api/candidate-imports/[importId]/file", () => {
  it("404s for another org's import", async () => {
    m(getImportForOrg).mockResolvedValueOnce(null);
    const res = await previewGET(req, { params: Promise.resolve({ importId: "i" }) });
    expect(res.status).toBe(404);
  });

  it("redirects to an inline signed URL", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ storagePath: "p/i/cv.pdf", status: "READY" });
    const res = await previewGET(req, { params: Promise.resolve({ importId: "i" }) });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://signed.example/f?token=1");
    expect(m(createDocumentSignedUrl)).toHaveBeenCalledWith("p/i/cv.pdf");
  });
});

describe("GET /api/candidates/[id]/documents/[documentId]", () => {
  it("404s when the document is not visible", async () => {
    m(prisma.candidateDocument.findFirst).mockResolvedValueOnce(null);
    const res = await downloadGET(req, { params: Promise.resolve({ id: "c", documentId: "d" }) });
    expect(res.status).toBe(404);
    expect(m(logAudit)).not.toHaveBeenCalled();
  });

  it("logs the download and redirects with a download file name", async () => {
    m(prisma.candidateDocument.findFirst).mockResolvedValueOnce({ id: "d", storagePath: "p/i/cv.pdf", fileName: "cv.pdf" });
    const res = await downloadGET(req, { params: Promise.resolve({ id: "c", documentId: "d" }) });
    expect(res.status).toBe(307);
    expect(m(createDocumentSignedUrl)).toHaveBeenCalledWith("p/i/cv.pdf", { downloadAs: "cv.pdf" });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({
      action: "candidate_document.download", resourceId: "d", metadata: { candidateId: "c" },
    });
  });
});
