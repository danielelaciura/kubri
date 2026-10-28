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

const SOURCES = ["extraction", "edit", "system"] as const;

// Read one entry at a time: a bad entry costs that field (asked again), not the profile.
// Extra keys are stripped; an unknown source (a newer release) falls back to "system".
const MetaSchema = z.object({
  confidence: z.number().min(0).max(1),
  status: z.enum(["confirmed", "inferred", "unresolved"]),
  source: z.string(),
});

const StoredProfileSchema = z.object({
  standard: z.record(z.string(), z.unknown()),
  custom: z.record(z.string(), z.unknown()),
  fieldMeta: z.record(z.string(), z.unknown()),
});

export interface ParseProfileOptions {
  /** Called with the path of what was dropped or replaced (never its value). */
  readonly onDropped?: (path: string) => void;
}

function isSource(source: string): source is ChangeSourceName {
  return (SOURCES as readonly string[]).includes(source);
}

/** What comes out of the database is a boundary: it is parsed, not trusted. */
export function parseStoredProfile(
  json: { standard: unknown; custom: unknown; fieldMeta: unknown },
  options: ParseProfileOptions = {},
): StoredProfile {
  const result = StoredProfileSchema.safeParse(json);
  if (!result.success) throw new Error("the stored profile cannot be read");
  const fieldMeta: Record<string, FieldMeta> = {};
  for (const [ref, raw] of Object.entries(result.data.fieldMeta)) {
    const meta = MetaSchema.safeParse(raw);
    if (!meta.success) {
      options.onDropped?.(`fieldMeta.${ref}`);
      continue;
    }
    const { source, ...rest } = meta.data;
    if (!isSource(source)) options.onDropped?.(`fieldMeta.${ref}.source`);
    fieldMeta[ref] = { ...rest, source: isSource(source) ? source : "system" };
  }
  return { standard: result.data.standard, custom: result.data.custom, fieldMeta };
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
