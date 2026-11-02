import { randomUUID } from "node:crypto";
import type { CandidateFields } from "@kubri/contracts";
import type { GlobalSharingMode, Prisma } from "@/generated/prisma/client";
import { geocodeFromAddress, type LatLng } from "@/lib/geo/proximity";
import { resolveSharedWithGlobal } from "@/lib/pools/global-sharing";
import { ingestCandidate } from "./ingest";

export type DashboardChannel = "dashboard_form" | "dashboard_cv";
/** Every channel that creates candidates from inside the app (not a webhook). */
export type CandidateCreateChannel = DashboardChannel | "landing_cv";

interface PoolRef {
  id: string;
  isGlobal: boolean;
  globalSharing: GlobalSharingMode;
}

/**
 * Map form fields to a Candidate row for an in-app created candidate
 * (operator form/CV, or the public landing). `externalId` is synthetic
 * ("dashboard:<uuid>" / "landing:<uuid>") so it never collides with Make keys
 * or assessment phones. Sharing follows the pool's globalSharing mode with the
 * candidate's own consent — only the public landing collects one.
 */
export function buildDashboardCandidateInput(args: {
  pool: PoolRef;
  fields: CandidateFields;
  channel: CandidateCreateChannel;
  rawPayload: Prisma.InputJsonValue;
  consentToShare?: boolean;
  /** Already resolved coordinates (public landing); skips offline geocoding. */
  coords?: LatLng;
}): Prisma.CandidateUncheckedCreateInput {
  const { pool, fields } = args;
  const coords = args.coords ?? geocodeFromAddress(fields.location) ?? geocodeFromAddress(fields.address);
  const idPrefix = args.channel === "landing_cv" ? "landing" : "dashboard";

  return {
    ...fields,
    externalId: `${idPrefix}:${randomUUID()}`,
    poolId: pool.id,
    latitude: coords?.latitude ?? null,
    longitude: coords?.longitude ?? null,
    channel: args.channel,
    sharedWithGlobal: resolveSharedWithGlobal(pool, args.consentToShare === true),
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
