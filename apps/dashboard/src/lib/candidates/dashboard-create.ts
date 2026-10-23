import { randomUUID } from "node:crypto";
import type { CandidateFields } from "@kubri/contracts";
import type { GlobalSharingMode, Prisma } from "@/generated/prisma/client";
import { geocodeFromAddress } from "@/lib/geo/proximity";
import { resolveSharedWithGlobal } from "@/lib/pools/global-sharing";
import { ingestCandidate } from "./ingest";

export type DashboardChannel = "dashboard_form" | "dashboard_cv";

interface PoolRef {
  id: string;
  isGlobal: boolean;
  globalSharing: GlobalSharingMode;
}

/**
 * Map form fields to a Candidate row for a dashboard-created candidate.
 * `externalId` is synthetic ("dashboard:<uuid>") so it never collides with
 * Make keys or assessment phones. No candidate consent is collected, so
 * sharing follows the pool's globalSharing mode with consent = false.
 */
export function buildDashboardCandidateInput(args: {
  pool: PoolRef;
  fields: CandidateFields;
  channel: DashboardChannel;
  rawPayload: Prisma.InputJsonValue;
}): Prisma.CandidateUncheckedCreateInput {
  const { pool, fields } = args;
  const coords = geocodeFromAddress(fields.location) ?? geocodeFromAddress(fields.address);

  return {
    externalId: `dashboard:${randomUUID()}`,
    poolId: pool.id,
    ...fields,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    channel: args.channel,
    sharedWithGlobal: resolveSharedWithGlobal(pool, false),
    rawPayload: args.rawPayload,
  };
}

/** Manual-mode creation: no import record, straight through ingestCandidate. */
export async function createCandidateManually(args: {
  pool: PoolRef;
  fields: CandidateFields;
  userId: string;
}): Promise<{ candidateId: string }> {
  const data = buildDashboardCandidateInput({
    pool: args.pool,
    fields: args.fields,
    channel: "dashboard_form",
    rawPayload: {
      mode: "form",
      createdById: args.userId,
      submitted: args.fields,
    } as unknown as Prisma.InputJsonValue,
  });
  return ingestCandidate(data, "dashboard create");
}
