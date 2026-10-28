import { z } from "zod";
import type { FieldStatus, ProfileSnapshot } from "../engine/profile-snapshot";
import { CUSTOM_FIELD_PREFIX } from "../profile/custom-fields";

export type ChangeSourceName = "extraction" | "edit" | "system";

export interface FieldMeta {
  readonly confidence: number;
  readonly status: FieldStatus;
  /** The source of the last update. */
  readonly source: ChangeSourceName;
}

/** The three JSON columns of CandidateProfile (spec §10.3). */
export interface StoredProfile {
  /** Standard fields by key, values only. */
  readonly standard: Readonly<Record<string, unknown>>;
  /** Custom fields by key without the `custom.` prefix. */
  readonly custom: Readonly<Record<string, unknown>>;
  /** By full field reference ("firstName", "custom.x"). */
  readonly fieldMeta: Readonly<Record<string, FieldMeta>>;
}

export const EMPTY_PROFILE: StoredProfile = { standard: {}, custom: {}, fieldMeta: {} };

const MetaSchema = z.strictObject({
  confidence: z.number().min(0).max(1),
  status: z.enum(["confirmed", "inferred", "unresolved"]),
  source: z.enum(["extraction", "edit", "system"]),
});

const StoredProfileSchema = z.strictObject({
  standard: z.record(z.string(), z.unknown()),
  custom: z.record(z.string(), z.unknown()),
  fieldMeta: z.record(z.string(), MetaSchema),
});

/** What comes out of the database is a boundary: it is parsed, not trusted. */
export function parseStoredProfile(json: {
  standard: unknown;
  custom: unknown;
  fieldMeta: unknown;
}): StoredProfile {
  const result = StoredProfileSchema.safeParse(json);
  if (!result.success) throw new Error("the stored profile cannot be read");
  return result.data;
}

function split(ref: string): { bucket: "standard" | "custom"; key: string } {
  return ref.startsWith(CUSTOM_FIELD_PREFIX)
    ? { bucket: "custom", key: ref.slice(CUSTOM_FIELD_PREFIX.length) }
    : { bucket: "standard", key: ref };
}

/** Pure: returns a new profile. An unresolved field keeps its meta but no value. */
export function setStoredField(
  profile: StoredProfile,
  ref: string,
  value: unknown,
  meta: FieldMeta,
): StoredProfile {
  const { bucket, key } = split(ref);
  const others = Object.entries(profile[bucket]).filter(([k]) => k !== key);
  const values: Record<string, unknown> = Object.fromEntries(
    meta.status === "unresolved" ? others : [...others, [key, value]],
  );
  return { ...profile, [bucket]: values, fieldMeta: { ...profile.fieldMeta, [ref]: meta } };
}

export function storedValue(profile: StoredProfile, ref: string): unknown {
  const { bucket, key } = split(ref);
  return Object.hasOwn(profile[bucket], key) ? profile[bucket][key] : undefined;
}

/** D31: the engine's flat snapshot, rebuilt from the profile row. */
export function toSnapshot(profile: StoredProfile): ProfileSnapshot {
  return Object.fromEntries(
    Object.entries(profile.fieldMeta).map(([ref, meta]) => [
      ref,
      {
        value: meta.status === "unresolved" ? null : (storedValue(profile, ref) ?? null),
        confidence: meta.confidence,
        status: meta.status,
      },
    ]),
  );
}
