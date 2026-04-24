import { prisma } from "@/lib/db";
import { MakeApiClient } from "./client";
import { cachedFetch, invalidateCache, LIST_TTL_MS } from "./cache";
import { normalizeCandidates } from "./normalize";
import type { Candidate } from "@/types";

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
