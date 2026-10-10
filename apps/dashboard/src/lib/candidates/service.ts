import { prisma } from "@/lib/db";
import { getOrgAccessiblePoolIds } from "@/lib/pools/access";
import { candidateVisibilityWhere } from "@/lib/pools/candidate-visibility";
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
      italianLevel: c.italianLevel ?? "",
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
  const rows = await prisma.candidate.findMany({
    where: candidateVisibilityWhere(poolIds),
    orderBy: { createdAt: "desc" },
  });
  return rows.map(dbCandidateToApp);
}

export async function getCandidatesForPool(
  poolId: string,
): Promise<Candidate[]> {
  // The Global pool also surfaces every sharedWithGlobal candidate, wherever
  // its home pool is (consent-gated cross-org visibility). Any other pool is
  // shown strictly — you see only the candidates that live in it.
  const pool = await prisma.pool.findUnique({
    where: { id: poolId },
    select: { isGlobal: true },
  });
  const rows = await prisma.candidate.findMany({
    where: pool?.isGlobal ? candidateVisibilityWhere([poolId]) : { poolId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(dbCandidateToApp);
}

export async function getCandidateForOrg(
  organizationId: string,
  candidateId: string,
): Promise<Candidate | null> {
  const poolIds = await getOrgAccessiblePoolIds(organizationId);
  const row = await prisma.candidate.findFirst({
    where: { id: candidateId, ...candidateVisibilityWhere(poolIds) },
  });
  return row ? dbCandidateToApp(row) : null;
}

export async function getCandidateByIdUnscoped(
  candidateId: string,
): Promise<Candidate | null> {
  const row = await prisma.candidate.findUnique({
    where: { id: candidateId },
  });
  return row ? dbCandidateToApp(row) : null;
}
