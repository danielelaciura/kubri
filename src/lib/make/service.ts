import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/encryption";
import { MakeApiClient, MakeNotFoundError } from "./client";
import { cachedFetch, invalidateCache, LIST_TTL_MS, RECORD_TTL_MS } from "./cache";
import { normalizeCandidate, normalizeCandidates } from "./normalize";
import type { Candidate } from "@/types";

async function getOrgCredentials(organizationId: string): Promise<{
  datastoreId: string;
  apiToken: string;
}> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { makeDatastoreId: true, makeApiToken: true },
  });

  return {
    datastoreId: org.makeDatastoreId,
    apiToken: decrypt(org.makeApiToken),
  };
}

function listCacheKey(orgId: string, datastoreId: string): string {
  return `make:${orgId}:${datastoreId}:list`;
}

function recordCacheKey(
  orgId: string,
  datastoreId: string,
  recordId: string,
): string {
  return `make:${orgId}:${datastoreId}:record:${recordId}`;
}

/**
 * Fetch all candidates for an organization from the Make.com Data Store.
 * Results are cached for 60 seconds.
 */
export async function getCandidatesForOrg(
  organizationId: string,
): Promise<Candidate[]> {
  const { datastoreId, apiToken } = await getOrgCredentials(organizationId);
  const client = new MakeApiClient(datastoreId, apiToken);

  const key = listCacheKey(organizationId, datastoreId);
  const response = await cachedFetch(
    key,
    () => client.listRecords(),
    LIST_TTL_MS,
  );

  return normalizeCandidates(response.records);
}

/**
 * Fetch a single candidate for an organization from the Make.com Data Store.
 * Results are cached for 30 seconds.
 * Returns null if the record is not found.
 */
export async function getCandidateForOrg(
  organizationId: string,
  recordId: string,
): Promise<Candidate | null> {
  const { datastoreId, apiToken } = await getOrgCredentials(organizationId);
  const client = new MakeApiClient(datastoreId, apiToken);

  const key = recordCacheKey(organizationId, datastoreId, recordId);
  try {
    const record = await cachedFetch(
      key,
      () => client.getRecord(recordId),
      RECORD_TTL_MS,
    );
    return normalizeCandidate(record);
  } catch (error) {
    if (error instanceof MakeNotFoundError) {
      return null;
    }
    throw error;
  }
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
