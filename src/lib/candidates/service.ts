import { prisma } from "@/lib/db";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import type { Candidate, Channel } from "@/types";
import type { CandidateModel as DbCandidate } from "@/generated/prisma/models/Candidate";

function dbCandidateToApp(c: DbCandidate): Candidate {
  const channel: Channel = c.channel === "whatsapp" ? "whatsapp" : "telegram";
  return {
    id: c.id,
    externalId: c.externalId,
    firstName: c.firstName ?? "",
    lastName: c.lastName ?? "",
    dateOfBirth: c.birthday ?? "",
    countryOfOrigin: c.countryOfOrigin ?? "",
    address: c.address ?? "",
    phone: c.phone ?? "",
    legalStatus: "",
    workingPermit: c.workingPermit ?? false,
    meanOfTransport: c.meanOfTransport ?? "",
    educationAndTraining: c.educationAndTraining,
    workExperience: c.workExperience,
    skillsAndCompetences: c.skillsAndCompetences,
    languages: {
      language: c.language ?? "",
      additionalLanguages: c.additionalLanguages,
    },
    drivingLicense: c.drivingLicense ?? false,
    jobPreferences: {
      desiredJob: c.desiredJob ?? "",
      partTimePreference: c.partTimePreference ?? false,
      preferredLocation: c.preferredLocation ?? "",
      constraints: c.jobConstraints ?? "",
      hasDesiredJobExperience: c.hasDesiredJobExperience ?? "",
    },
    centroPerImpiego: "",
    interviewLanguage: c.interviewLanguage ?? c.language ?? "",
    sourceOrganization: c.sourceOrganization ?? "",
    channel,
    consent: false,
    cvPdfLink: "",
    cvDocLink: "",
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    createdAt: c.sourceUpdatedAt ?? c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export async function getCandidatesForOrg(
  organizationId: string,
): Promise<Candidate[]> {
  const poolIds = await getOrgAccessiblePoolIds(organizationId);
  if (poolIds.length === 0) return [];
  const rows = await prisma.candidate.findMany({
    where: { poolId: { in: poolIds } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(dbCandidateToApp);
}

export async function getCandidatesForPool(
  poolId: string,
): Promise<Candidate[]> {
  const rows = await prisma.candidate.findMany({
    where: { poolId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(dbCandidateToApp);
}

export async function getCandidateForOrg(
  organizationId: string,
  candidateId: string,
): Promise<Candidate | null> {
  const poolIds = await getOrgAccessiblePoolIds(organizationId);
  if (poolIds.length === 0) return null;
  const row = await prisma.candidate.findFirst({
    where: { id: candidateId, poolId: { in: poolIds } },
  });
  return row ? dbCandidateToApp(row) : null;
}
