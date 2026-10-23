import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/auth-utils", () => ({ requireOrganization: vi.fn() }));
vi.mock("@/lib/pools/access", () => ({ getOrgWritablePools: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/candidates/dashboard-create", () => ({ createCandidateManually: vi.fn() }));
vi.mock("@/lib/candidate-imports/service", () => ({
  createUploadTicket: vi.fn(),
  registerUpload: vi.fn(),
  runExtraction: vi.fn(),
  confirmImport: vi.fn(),
  discardImport: vi.fn(),
  getImportForOrg: vi.fn(),
}));

import { requireOrganization } from "@/lib/auth-utils";
import { getOrgWritablePools } from "@/lib/pools/access";
import { logAudit } from "@/lib/audit";
import { createCandidateManually } from "@/lib/candidates/dashboard-create";
import {
  confirmImport,
  createUploadTicket,
  getImportForOrg,
  discardImport,
  registerUpload,
  runExtraction,
} from "@/lib/candidate-imports/service";
import { ImportError, ImportStateError } from "@/lib/candidate-imports/errors";
import {
  confirmCandidateImportAction,
  createCandidateManuallyAction,
  registerCandidateUploadAction,
  requestCandidateUploadAction,
  runCandidateImportExtractionAction,
  discardCandidateImportAction,
} from "@/app/(dashboard)/dashboard/candidates/new/actions";

const IMP = "22222222-2222-4222-8222-222222222222";
const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const USER = { id: "u-1", organizationId: "org-1", role: "ORG_MEMBER" };
const POOL = { id: "pool-1", name: "Coop", isGlobal: false, globalSharing: "WEBHOOK" };
const VALUES = {
  firstName: "Ahmed", lastName: "Benali", birthday: null, countryOfOrigin: null, address: null,
  location: null, phone: null, email: null, workingPermit: null, meanOfTransport: null,
  drivingLicense: null, educationAndTraining: [], workExperience: [], skillsAndCompetences: [],
  language: null, additionalLanguages: [], italianLevel: null, desiredJob: null,
  partTimePreference: null, preferredLocation: null, jobConstraints: null,
};

beforeEach(() => {
  vi.resetAllMocks();
  m(requireOrganization).mockResolvedValue(USER);
  m(getOrgWritablePools).mockResolvedValue([POOL]);
});

describe("requestCandidateUploadAction", () => {
  it("rejects a pool the org cannot write to", async () => {
    const r = await requestCandidateUploadAction({ poolId: "other", fileName: "cv.pdf", fileSize: 10 });
    expect(r).toEqual({ ok: false, error: "INVALID_POOL" });
    expect(m(createUploadTicket)).not.toHaveBeenCalled();
  });

  it("returns the upload ticket", async () => {
    m(createUploadTicket).mockResolvedValueOnce({ importId: "i", storagePath: "p", token: "t" });
    const r = await requestCandidateUploadAction({ poolId: "pool-1", fileName: "cv.pdf", fileSize: 10 });
    expect(r).toEqual({ ok: true, data: { importId: "i", storagePath: "p", token: "t" } });
  });

  it("maps ImportError codes", async () => {
    m(createUploadTicket).mockRejectedValueOnce(new ImportError("FILE_TOO_LARGE"));
    const r = await requestCandidateUploadAction({ poolId: "pool-1", fileName: "cv.pdf", fileSize: 1e9 });
    expect(r).toEqual({ ok: false, error: "FILE_TOO_LARGE" });
  });
});

describe("registerCandidateUploadAction", () => {
  it("registers with the user's org and logs the audit event", async () => {
    m(registerUpload).mockResolvedValueOnce({ importId: "i" });
    const r = await registerCandidateUploadAction({
      importId: "11111111-1111-4111-8111-111111111111", poolId: "pool-1", fileName: "cv.pdf",
    });
    expect(r).toEqual({ ok: true, data: { importId: "i" } });
    expect(m(registerUpload).mock.calls[0]![0]).toMatchObject({
      organizationId: "org-1", createdById: "u-1", origin: "OPERATOR",
    });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({
      action: "candidate_import.create", resourceType: "candidate_import", resourceId: "i",
    });
  });
});

describe("runCandidateImportExtractionAction", () => {
  it("refuses an import of another org", async () => {
    m(getImportForOrg).mockResolvedValueOnce(null);
    const r = await runCandidateImportExtractionAction("33333333-3333-4333-8333-333333333333");
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m(runExtraction)).not.toHaveBeenCalled();
  });

  it("runs the extraction for an own import", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222" });
    await expect(runCandidateImportExtractionAction("22222222-2222-4222-8222-222222222222")).resolves.toEqual({ ok: true, data: null });
    expect(m(runExtraction)).toHaveBeenCalledWith("22222222-2222-4222-8222-222222222222");
  });
});

describe("confirmCandidateImportAction", () => {
  it("returns field errors without calling the service", async () => {
    const r = await confirmCandidateImportAction("22222222-2222-4222-8222-222222222222", { ...VALUES, lastName: "" });
    expect(r).toEqual({ ok: false, error: "VALIDATION", fieldErrors: { lastName: "required" } });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("returns INVALID_POOL when the import's pool is no longer writable", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ ...{ id: "22222222-2222-4222-8222-222222222222", poolId: "pool-1", status: "READY", candidateId: null }, poolId: "pool-gone" });
    const r = await confirmCandidateImportAction("22222222-2222-4222-8222-222222222222", VALUES);
    expect(r).toEqual({ ok: false, error: "INVALID_POOL" });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("returns NOT_FOUND for an import of another org", async () => {
    m(getImportForOrg).mockResolvedValueOnce(null);
    const r = await confirmCandidateImportAction("33333333-3333-4333-8333-333333333333", VALUES);
    expect(r).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m(confirmImport)).not.toHaveBeenCalled();
  });

  it("confirms and logs candidate.create with mode cv", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222", poolId: "pool-1", status: "READY", candidateId: null });
    m(confirmImport).mockResolvedValueOnce({ candidateId: "c-1" });
    const r = await confirmCandidateImportAction("22222222-2222-4222-8222-222222222222", VALUES);
    expect(r).toEqual({ ok: true, data: { candidateId: "c-1" } });
    expect(m(confirmImport).mock.calls[0]![0]).toMatchObject({ importId: "22222222-2222-4222-8222-222222222222", organizationId: "org-1", userId: "u-1" });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({
      action: "candidate.create", resourceId: "c-1", metadata: { mode: "cv", importId: "22222222-2222-4222-8222-222222222222" },
    });
  });

  it("returns the existing candidate when a concurrent confirm won", async () => {
    m(getImportForOrg)
      .mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222", poolId: "pool-1", status: "READY", candidateId: null })
      .mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222", poolId: "pool-1", status: "COMPLETED", candidateId: "c-9" });
    m(confirmImport).mockRejectedValueOnce(new ImportStateError("COMPLETED"));
    const r = await confirmCandidateImportAction("22222222-2222-4222-8222-222222222222", VALUES);
    expect(r).toEqual({ ok: true, data: { candidateId: "c-9" } });
  });
});

describe("importId validation", () => {
  for (const bad of [{ not: "x" } as never, "abc"]) {
    const label = typeof bad === "string" ? bad : "object";
    it(`run/confirm/discard reject ${label} without touching the service`, async () => {
      expect(await runCandidateImportExtractionAction(bad)).toEqual({ ok: false, error: "VALIDATION" });
      expect(await confirmCandidateImportAction(bad, VALUES)).toEqual({ ok: false, error: "VALIDATION" });
      expect(await discardCandidateImportAction(bad)).toEqual({ ok: false, error: "VALIDATION" });
      for (const f of [getImportForOrg, runExtraction, confirmImport, discardImport]) {
        expect(m(f)).not.toHaveBeenCalled();
      }
    });
  }

  it("run uses the id resolved from the database", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ id: "44444444-4444-4444-8444-444444444444" });
    await runCandidateImportExtractionAction(IMP);
    expect(m(runExtraction)).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444");
  });

  it("run maps a thrown error instead of throwing", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ id: IMP });
    m(runExtraction).mockRejectedValueOnce(new Error("boom"));
    expect(await runCandidateImportExtractionAction(IMP)).toEqual({ ok: false, error: "INTERNAL_ERROR" });
  });

  it("discard happy path uses the resolved id", async () => {
    m(getImportForOrg).mockResolvedValueOnce({ id: IMP });
    m(discardImport).mockResolvedValueOnce(true);
    expect(await discardCandidateImportAction(IMP)).toEqual({ ok: true, data: null });
    expect(m(discardImport)).toHaveBeenCalledWith(IMP, "org-1");
  });

  it("discard returns NOT_FOUND for an unknown import", async () => {
    m(getImportForOrg).mockResolvedValueOnce(null);
    expect(await discardCandidateImportAction(IMP)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(m(discardImport)).not.toHaveBeenCalled();
  });
});

describe("audit failures", () => {
  it("do not fail a successful manual creation", async () => {
    m(createCandidateManually).mockResolvedValueOnce({ candidateId: "c-2" });
    m(logAudit).mockRejectedValueOnce(new Error("audit down"));
    expect(await createCandidateManuallyAction("pool-1", VALUES)).toEqual({ ok: true, data: { candidateId: "c-2" } });
  });
});

describe("createCandidateManuallyAction", () => {
  it("rejects an invalid pool", async () => {
    const r = await createCandidateManuallyAction("other", VALUES);
    expect(r).toEqual({ ok: false, error: "INVALID_POOL" });
  });

  it("creates and logs candidate.create with mode form", async () => {
    m(createCandidateManually).mockResolvedValueOnce({ candidateId: "c-2" });
    const r = await createCandidateManuallyAction("pool-1", VALUES);
    expect(r).toEqual({ ok: true, data: { candidateId: "c-2" } });
    expect(m(createCandidateManually).mock.calls[0]![0]).toMatchObject({ pool: POOL, userId: "u-1" });
    expect(m(logAudit).mock.calls[0]![0]).toMatchObject({ action: "candidate.create", metadata: { mode: "form" } });
  });
});
