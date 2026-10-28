import { Prisma } from "../generated/prisma/client";
import {
  parseStoredProfile,
  setStoredField,
  storedValue,
  type ChangeSourceName,
  type StoredProfile,
} from "../runtime/profile-codec";
import type { Tx } from "./db";
import { asJson, toNullableJson as toJson } from "./json";

const PROFILE_COLUMNS = { id: true, standard: true, custom: true, fieldMeta: true } as const;

/** The codec reads exactly the three JSON columns (strict schema): the row id stays out. */
function parseRow(row: { standard: unknown; custom: unknown; fieldMeta: unknown }): StoredProfile {
  return parseStoredProfile({
    standard: row.standard,
    custom: row.custom,
    fieldMeta: row.fieldMeta,
  });
}

function columns(profile: StoredProfile) {
  return {
    standard: asJson(profile.standard),
    custom: asJson(profile.custom),
    fieldMeta: asJson(profile.fieldMeta),
  };
}

export async function loadProfile(tx: Tx, sessionId: string): Promise<StoredProfile> {
  const row = await tx.candidateProfile.findUniqueOrThrow({
    where: { sessionId },
    select: PROFILE_COLUMNS,
  });
  return parseRow(row);
}

export interface FieldUpdate {
  readonly field: string;
  readonly value: unknown;
  readonly confidence: number;
  readonly status: "confirmed" | "inferred";
}

/** One ProfileChange per field (CLAUDE.md), in the same transaction as the profile. */
export async function applyProfileFields(
  tx: Tx,
  sessionId: string,
  source: ChangeSourceName,
  turnId: string | null,
  fields: readonly FieldUpdate[],
): Promise<void> {
  const row = await tx.candidateProfile.findUniqueOrThrow({
    where: { sessionId },
    select: PROFILE_COLUMNS,
  });
  let profile = parseRow(row);
  for (const f of fields) {
    const oldValue = storedValue(profile, f.field);
    profile = setStoredField(profile, f.field, f.value, {
      confidence: f.confidence,
      status: f.status,
      source,
    });
    await tx.profileChange.create({
      data: {
        profileId: row.id,
        field: f.field,
        oldValue: toJson(oldValue),
        newValue: toJson(f.value),
        source,
        turnId,
        confidence: f.confidence,
      },
    });
  }
  await tx.candidateProfile.update({
    where: { id: row.id },
    data: columns(profile),
  });
}

/** The engine gave up on a required field: the value goes, the field stays known (spec §6). */
export async function markFieldUnresolved(
  tx: Tx,
  sessionId: string,
  field: string,
  turnId: string | null,
): Promise<void> {
  const row = await tx.candidateProfile.findUniqueOrThrow({
    where: { sessionId },
    select: PROFILE_COLUMNS,
  });
  const profile = parseRow(row);
  const next = setStoredField(profile, field, null, {
    confidence: 0,
    status: "unresolved",
    source: "system",
  });
  await tx.profileChange.create({
    data: {
      profileId: row.id,
      field,
      oldValue: toJson(storedValue(profile, field)),
      newValue: Prisma.JsonNull,
      source: "system",
      turnId,
    },
  });
  await tx.candidateProfile.update({
    where: { id: row.id },
    data: columns(next),
  });
}

export async function setSharedWithGlobal(
  tx: Tx,
  sessionId: string,
  shared: boolean,
): Promise<void> {
  await tx.candidateProfile.update({ where: { sessionId }, data: { sharedWithGlobal: shared } });
}

export async function markProfileCompleted(tx: Tx, sessionId: string, at: Date): Promise<void> {
  await tx.candidateProfile.update({ where: { sessionId }, data: { completedAt: at } });
}

/**
 * D109, spec §10.6: `dataPolicy: delete`. The profile and what it was built from go; replies
 * still waiting to be sent stay (they are the goodbye). The Consent rows are not touched.
 */
export async function purgeSessionData(tx: Tx, sessionId: string): Promise<void> {
  await tx.profileChange.deleteMany({ where: { profile: { sessionId } } });
  await tx.candidateProfile.update({
    where: { sessionId },
    data: { standard: {}, custom: {}, fieldMeta: {}, sharedWithGlobal: false },
  });
  await tx.nluTrace.deleteMany({ where: { turn: { sessionId } } });
  await tx.message.updateMany({
    where: { sessionId, NOT: { direction: "outbound", status: { in: ["queued", "sending"] } } },
    data: { body: null, bodyRedacted: null, payloadRaw: Prisma.DbNull },
  });
  await tx.message.updateMany({
    where: { sessionId, direction: "outbound", status: { in: ["queued", "sending"] } },
    data: { bodyRedacted: null, payloadRaw: Prisma.DbNull },
  });
}
