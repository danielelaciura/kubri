import { prisma } from "@/lib/db";
import { resolveLocation } from "@/lib/geo/resolve";
import type { JobDescriptionInput } from "@/lib/validations/job-description";

export class JobNameAlreadyExistsError extends Error {
  constructor() {
    super("Esiste già un'offerta di lavoro con questo nome");
    this.name = "JobNameAlreadyExistsError";
  }
}

export class JobNotFoundError extends Error {
  constructor() {
    super("Offerta di lavoro non trovata");
    this.name = "JobNotFoundError";
  }
}

function resolveAndSpread(locationRaw: string) {
  const r = resolveLocation(locationRaw);
  return {
    locationRaw,
    locationMunicipality: r.municipality ?? null,
    locationProvince: r.province ?? null,
    locationRegion: r.region ?? null,
  };
}

export async function createJobDescription(params: {
  input: JobDescriptionInput;
  organizationId: string;
  userId: string;
}) {
  const { input, organizationId, userId } = params;
  try {
    return await prisma.jobDescription.create({
      data: {
        organizationId,
        createdByUserId: userId,
        name: input.name,
        description: input.description,
        skills: input.skills,
        searchRadiusKm: input.searchRadiusKm,
        ...resolveAndSpread(input.locationRaw),
      },
    });
  } catch (e: unknown) {
    if (isPrismaCode(e, "P2002")) throw new JobNameAlreadyExistsError();
    throw e;
  }
}

export async function listJobDescriptions(params: { organizationId: string }) {
  return prisma.jobDescription.findMany({
    where: { organizationId: params.organizationId },
    orderBy: { createdAt: "desc" },
    include: { createdBy: { select: { name: true } } },
  });
}

export async function getJobDescription(params: { id: string; organizationId: string }) {
  return prisma.jobDescription.findFirst({
    where: { id: params.id, organizationId: params.organizationId },
  });
}

export async function updateJobDescription(params: {
  id: string;
  organizationId: string;
  input: JobDescriptionInput;
}) {
  const { id, organizationId, input } = params;
  try {
    const result = await prisma.jobDescription.updateMany({
      where: { id, organizationId },
      data: {
        name: input.name,
        description: input.description,
        skills: input.skills,
        searchRadiusKm: input.searchRadiusKm,
        ...resolveAndSpread(input.locationRaw),
      },
    });
    if (result.count === 0) throw new JobNotFoundError();
    return result;
  } catch (e: unknown) {
    if (e instanceof JobNotFoundError) throw e;
    if (isPrismaCode(e, "P2002")) throw new JobNameAlreadyExistsError();
    throw e;
  }
}

export async function deleteJobDescription(params: { id: string; organizationId: string }) {
  const result = await prisma.jobDescription.deleteMany({
    where: { id: params.id, organizationId: params.organizationId },
  });
  if (result.count === 0) throw new JobNotFoundError();
  return result;
}

export async function listAllJobDescriptionsForAdmin() {
  return prisma.jobDescription.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      organization: { select: { name: true, slug: true } },
      createdBy: { select: { name: true } },
    },
  });
}

function isPrismaCode(e: unknown, code: string): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === code;
}
