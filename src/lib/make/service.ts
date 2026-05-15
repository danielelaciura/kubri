import { prisma } from "@/lib/db";
import { MakeApiClient } from "./client";
import { cachedFetch, invalidateCache, LIST_TTL_MS } from "./cache";
import { normalizeCandidates } from "./normalize";
import {
  getOrgAccessiblePoolIds,
  getOrgAccessiblePools,
} from "@/lib/pools/access";
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
    dbId: c.id,
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

async function getCandidatesFromDb(
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

function getApiToken(): string {
  const token = process.env["MAKE_API_TOKEN"];
  if (!token) {
    throw new Error("MAKE_API_TOKEN environment variable is not set");
  }
  return token;
}

/**
 * Cache key for the list of candidates from a single Make.com Data Store.
 * Keyed by `externalKey` (the Make.com datastore id) — NOT by org — because
 * the same pool (e.g. the global pool) can be shared across multiple orgs
 * and we want them to share the cache entry.
 */
function listCacheKey(externalKey: string): string {
  return `make:${externalKey}:list`;
}

async function getCandidatesFromMake(
  organizationId: string,
): Promise<Candidate[]> {
  const pools = await getOrgAccessiblePools(organizationId);
  const externalKeys = pools
    .map((p) => p.externalKey)
    .filter((k): k is string => Boolean(k));
  if (externalKeys.length === 0) return [];

  const token = getApiToken();
  const all = await Promise.all(
    externalKeys.map(async (extKey) => {
      const client = new MakeApiClient(extKey, token);
      const response = await cachedFetch(
        listCacheKey(extKey),
        () => client.listAllRecords(),
        LIST_TTL_MS,
      );
      return normalizeCandidates(response.records);
    }),
  );
  return all.flat();
}

/**
 * Fetch all candidates for an organization from the Make.com Data Store.
 * Iterates over every pool attached to the org and merges the results.
 * Each pool's list is cached for 60 seconds, keyed by its externalKey
 * (so pools shared across orgs share the cache entry).
 */
export async function getCandidatesForOrg(
  organizationId: string,
): Promise<Candidate[]> {
  if (USE_PG_CANDIDATES) {
    return getCandidatesFromDb(organizationId);
  }
  return getCandidatesFromMake(organizationId);
}

/**
 * Fetch all candidates of a single pool, ignoring org membership.
 * Intended for ADMIN_KUBRI views where the admin picks an explicit pool.
 * Uses the same per-pool cache as getCandidatesForOrg.
 */
export async function getCandidatesForPool(
  poolId: string,
): Promise<Candidate[]> {
  if (USE_PG_CANDIDATES) {
    const rows = await prisma.candidate.findMany({
      where: { poolId },
      orderBy: { createdAt: "desc" },
    });
    return rows.map(dbCandidateToApp);
  }
  const pool = await prisma.pool.findUnique({ where: { id: poolId } });
  if (!pool?.externalKey) return [];
  const token = getApiToken();
  const client = new MakeApiClient(pool.externalKey, token);
  const response = await cachedFetch(
    listCacheKey(pool.externalKey),
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
 *
 * Since cache keys are now keyed by externalKey (not orgId), we look up
 * the org's pools and invalidate each pool's cache prefix. Note that this
 * also invalidates the cache for OTHER orgs that share the same pool
 * (e.g. the global pool) — acceptable, since the underlying data is shared.
 */
export async function invalidateOrgCache(
  organizationId: string,
): Promise<void> {
  const pools = await getOrgAccessiblePools(organizationId);
  for (const p of pools) {
    if (p.externalKey) invalidateCache(`make:${p.externalKey}`);
  }
}
