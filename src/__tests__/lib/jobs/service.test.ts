import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createJobDescription,
  listJobDescriptions,
  getJobDescription,
  updateJobDescription,
  deleteJobDescription,
  JobNameAlreadyExistsError,
  JobNotFoundError,
} from "@/lib/jobs/service";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobDescription: {
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  name: "Addetto pulizie",
  locationRaw: "Milano",
  description: "Cerchiamo personale per pulizie di uffici.",
  skills: ["pulizie"],
  searchRadiusKm: 25,
};

describe("createJobDescription", () => {
  it("resolves location and forwards to Prisma with org scoping", async () => {
    mockPrisma.jobDescription.create.mockResolvedValue({ id: "jd-1" });
    await createJobDescription({ input: baseInput, organizationId: "org-1", userId: "user-1" });
    expect(mockPrisma.jobDescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: "org-1",
          createdByUserId: "user-1",
          name: "Addetto pulizie",
          locationRaw: "Milano",
          locationMunicipality: "Milano",
          locationProvince: "Milano",
          locationRegion: "Lombardia",
          searchRadiusKm: 25,
        }),
      })
    );
  });

  it("forwards a custom searchRadiusKm", async () => {
    mockPrisma.jobDescription.create.mockResolvedValue({ id: "jd-1" });
    await createJobDescription({
      input: { ...baseInput, searchRadiusKm: 75 },
      organizationId: "org-1",
      userId: "user-1",
    });
    expect(mockPrisma.jobDescription.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ searchRadiusKm: 75 }),
      }),
    );
  });

  it("maps Prisma P2002 unique error to JobNameAlreadyExistsError", async () => {
    mockPrisma.jobDescription.create.mockRejectedValue({ code: "P2002" });
    await expect(
      createJobDescription({ input: baseInput, organizationId: "org-1", userId: "user-1" })
    ).rejects.toBeInstanceOf(JobNameAlreadyExistsError);
  });
});

describe("listJobDescriptions", () => {
  it("filters by organizationId", async () => {
    mockPrisma.jobDescription.findMany.mockResolvedValue([]);
    await listJobDescriptions({ organizationId: "org-1" });
    expect(mockPrisma.jobDescription.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org-1" },
      })
    );
  });
});

describe("getJobDescription", () => {
  it("returns null when no row is found", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([]);
    const r = await getJobDescription({ id: "jd-1", organizationId: "org-1" });
    expect(r).toBeNull();
  });

  it("returns normalized record with embedding as number[] when found", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        id: "jd-1",
        name: "Test",
        description: "Desc",
        skills: ["skill1"],
        locationRaw: "Milano",
        locationMunicipality: "Milano",
        locationProvince: "Milano",
        locationRegion: "Lombardia",
        searchRadiusKm: 25,
        embedding: "[0.1,0.2,0.3]",
      },
    ]);
    const r = await getJobDescription({ id: "jd-1", organizationId: "org-1" });
    expect(r).not.toBeNull();
    expect(r!.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(r!.name).toBe("Test");
  });

  it("returns null embedding when embedding is null in DB", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      {
        id: "jd-1",
        name: "Test",
        description: "Desc",
        skills: [],
        locationRaw: "Roma",
        locationMunicipality: null,
        locationProvince: null,
        locationRegion: null,
        searchRadiusKm: 10,
        embedding: null,
      },
    ]);
    const r = await getJobDescription({ id: "jd-1", organizationId: "org-1" });
    expect(r!.embedding).toBeNull();
  });
});

describe("updateJobDescription", () => {
  it("re-resolves location and scopes update by org", async () => {
    mockPrisma.jobDescription.updateMany.mockResolvedValue({ count: 1 });
    await updateJobDescription({
      id: "jd-1",
      organizationId: "org-1",
      input: { ...baseInput, locationRaw: "Lombardia" },
    });
    expect(mockPrisma.jobDescription.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "jd-1", organizationId: "org-1" },
        data: expect.objectContaining({
          locationRaw: "Lombardia",
          locationRegion: "Lombardia",
          locationProvince: null,
          locationMunicipality: null,
          searchRadiusKm: 25,
        }),
      })
    );
  });

  it("throws JobNotFoundError when count is 0", async () => {
    mockPrisma.jobDescription.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      updateJobDescription({ id: "jd-1", organizationId: "org-1", input: baseInput })
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });
});

describe("deleteJobDescription", () => {
  it("scopes delete by org", async () => {
    mockPrisma.jobDescription.deleteMany.mockResolvedValue({ count: 1 });
    await deleteJobDescription({ id: "jd-1", organizationId: "org-1" });
    expect(mockPrisma.jobDescription.deleteMany).toHaveBeenCalledWith({
      where: { id: "jd-1", organizationId: "org-1" },
    });
  });

  it("throws JobNotFoundError when count is 0", async () => {
    mockPrisma.jobDescription.deleteMany.mockResolvedValue({ count: 0 });
    await expect(
      deleteJobDescription({ id: "jd-1", organizationId: "org-1" })
    ).rejects.toBeInstanceOf(JobNotFoundError);
  });
});
