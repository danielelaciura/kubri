import { prisma } from "@/lib/db";
import { MakeApiClient } from "./client";
import { cachedFetch, invalidateCache, LIST_TTL_MS } from "./cache";
import { normalizeCandidates } from "./normalize";
import type { Candidate, Channel } from "@/types";
import type { CandidateModel as DbCandidate } from "@/generated/prisma/models/Candidate";

/**
 * TEMPORARY: when USE_PG_CANDIDATES=1 the read path serves candidates from
 * the local Postgres Candidate table (populated by the Make webhook + the
 * seed script) instead of calling the Make.com Data Store API. Lets us
 * verify seeded data + the upcoming Phase 2 migration without touching
 * the Make scenario yet.
 */
const USE_PG_CANDIDATES = process.env["USE_PG_CANDIDATES"] === "1";

function dbCandidateToApp(c: DbCandidate): Candidate {
  const channel: Channel = c.channel === "whatsapp" ? "whatsapp" : "telegram";
  return {
    id: c.externalId,
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
    createdAt: c.sourceUpdatedAt ?? c.createdAt,
    updatedAt: c.updatedAt,
  };
}

async function getCandidatesFromDb(
  organizationId: string,
): Promise<Candidate[]> {
  const datastoreId = await getOrgDatastoreId(organizationId);
  const rows = await prisma.candidate.findMany({
    where: { makeDatastoreId: datastoreId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(dbCandidateToApp);
}

function getApiToken(): string {
  const token = process.env["MAKE_API_TOKEN"];
  if (!token) {
    throw new Error("MAKE_API_TOKEN environment variable is not set");
  }
  return token;
}

async function getOrgDatastoreId(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { makeDatastoreId: true },
  });
  return org.makeDatastoreId;
}

function listCacheKey(orgId: string, datastoreId: string): string {
  return `make:${orgId}:${datastoreId}:list`;
}


/**
 * Fetch all candidates for an organization from the Make.com Data Store.
 * Results are cached for 60 seconds.
 */
export async function getCandidatesForOrg(
  organizationId: string,
): Promise<Candidate[]> {
  if (USE_PG_CANDIDATES) {
    return getCandidatesFromDb(organizationId);
  }

  const datastoreId = await getOrgDatastoreId(organizationId);
  const client = new MakeApiClient(datastoreId, getApiToken());

  const key = listCacheKey(organizationId, datastoreId);
  const response = await cachedFetch(
    key,
    () => client.listAllRecords(),
    LIST_TTL_MS,
  );

  return normalizeCandidates(response.records);
}

/**
 * Fetch a single candidate for an organization from the Make.com Data Store.
 * Uses the list endpoint and filters by key, since the Make.com Data Store API
 * does not support fetching a single record by key.
 * Returns null if the record is not found.
 */
export async function getCandidateForOrg(
  organizationId: string,
  recordId: string,
): Promise<Candidate | null> {
  const candidates = await getCandidatesForOrg(organizationId);
  return candidates.find((c) => c.id === recordId) ?? null;
}

/**
 * Invalidate all cached data for an organization.
 * Called when the user clicks the refresh button.
 */
export async function invalidateOrgCache(
  organizationId: string,
): Promise<void> {
  invalidateCache(`make:${organizationId}`);
}
