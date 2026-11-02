import { z } from "zod/v4";

/** Optional free text: trimmed, length-capped, "" → null. */
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((s) => (s ? s : null));

/** List of free-text entries: each trimmed and capped, empty entries dropped. */
const textList = (maxItems: number, maxLen: number) =>
  z
    .array(z.string().trim().max(maxLen))
    .max(maxItems)
    .transform((items) => items.filter((s) => s.length > 0));

const optEmail = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .nullable()
  .transform((s) => (s ? s : null))
  .pipe(z.email().nullable());

/** Length limits shared by the strict form schema and the lenient draft schema. */
const LIMITS = {
  firstName: 100,
  lastName: 100,
  birthday: 40,
  countryOfOrigin: 100,
  address: 300,
  location: 200,
  phone: 40,
  meanOfTransport: 100,
  language: 100,
  italianLevel: 50,
  desiredJob: 200,
  preferredLocation: 200,
  jobConstraints: 1000,
} as const;

const LIST_LIMITS = {
  educationAndTraining: { maxItems: 30, maxLen: 500 },
  workExperience: { maxItems: 30, maxLen: 500 },
  skillsAndCompetences: { maxItems: 50, maxLen: 200 },
  additionalLanguages: { maxItems: 20, maxLen: 100 },
} as const;

/** Draft (LLM output) text: trimmed, "" → null, truncated to `max` instead of rejected. */
const draftText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((s) => {
      const t = (s ?? "").trim();
      return t ? t.slice(0, max) : null;
    });

/** Draft list: entries trimmed and truncated, empties dropped, capped at `maxItems`. */
const draftList = (maxItems: number, maxLen: number) =>
  z
    .array(z.string())
    .transform((items) =>
      items
        .map((s) => s.trim().slice(0, maxLen))
        .filter((s) => s.length > 0)
        .slice(0, maxItems),
    );

const L = LIST_LIMITS;

/** Strict shape (form submission). */
const sharedShape = {
  birthday: optText(LIMITS.birthday),
  countryOfOrigin: optText(LIMITS.countryOfOrigin),
  address: optText(LIMITS.address),
  location: optText(LIMITS.location),
  phone: optText(LIMITS.phone),
  email: optEmail,
  workingPermit: z.boolean().nullable(),
  meanOfTransport: optText(LIMITS.meanOfTransport),
  drivingLicense: z.boolean().nullable(),
  educationAndTraining: textList(L.educationAndTraining.maxItems, L.educationAndTraining.maxLen),
  workExperience: textList(L.workExperience.maxItems, L.workExperience.maxLen),
  skillsAndCompetences: textList(L.skillsAndCompetences.maxItems, L.skillsAndCompetences.maxLen),
  language: optText(LIMITS.language),
  additionalLanguages: textList(L.additionalLanguages.maxItems, L.additionalLanguages.maxLen),
  italianLevel: optText(LIMITS.italianLevel),
  desiredJob: optText(LIMITS.desiredJob),
  partTimePreference: z.boolean().nullable(),
  preferredLocation: optText(LIMITS.preferredLocation),
  jobConstraints: optText(LIMITS.jobConstraints),
};

/** Lenient shape (draft): same limits, but truncates instead of rejecting. Email stays strict. */
const draftShape = {
  birthday: draftText(LIMITS.birthday),
  countryOfOrigin: draftText(LIMITS.countryOfOrigin),
  address: draftText(LIMITS.address),
  location: draftText(LIMITS.location),
  phone: draftText(LIMITS.phone),
  email: optEmail,
  workingPermit: z.boolean().nullable(),
  meanOfTransport: draftText(LIMITS.meanOfTransport),
  drivingLicense: z.boolean().nullable(),
  educationAndTraining: draftList(L.educationAndTraining.maxItems, L.educationAndTraining.maxLen),
  workExperience: draftList(L.workExperience.maxItems, L.workExperience.maxLen),
  skillsAndCompetences: draftList(L.skillsAndCompetences.maxItems, L.skillsAndCompetences.maxLen),
  language: draftText(LIMITS.language),
  additionalLanguages: draftList(L.additionalLanguages.maxItems, L.additionalLanguages.maxLen),
  italianLevel: draftText(LIMITS.italianLevel),
  desiredJob: draftText(LIMITS.desiredJob),
  partTimePreference: z.boolean().nullable(),
  preferredLocation: draftText(LIMITS.preferredLocation),
  jobConstraints: draftText(LIMITS.jobConstraints),
};

/**
 * Candidate profile fields as submitted from the dashboard form (and, later,
 * the public upload page). First and last name are required: the candidates
 * list hides rows without a last name.
 */
export const candidateFieldsSchema = z.object({
  firstName: z.string().trim().min(1).max(LIMITS.firstName),
  lastName: z.string().trim().min(1).max(LIMITS.lastName),
  ...sharedShape,
});
export type CandidateFields = z.output<typeof candidateFieldsSchema>;
export type CandidateFieldsInput = z.input<typeof candidateFieldsSchema>;
export type CandidateFieldKey = keyof CandidateFields;

/** Same fields with names optional — what an LLM extraction can produce. */
export const candidateDraftFieldsSchema = z.object({
  firstName: draftText(LIMITS.firstName),
  lastName: draftText(LIMITS.lastName),
  ...draftShape,
});
export type CandidateDraftFields = z.output<typeof candidateDraftFieldsSchema>;

/** Extraction result stored on CandidateImport.draft. */
export const candidateDraftSchema = z.object({
  isCv: z.boolean(),
  fields: candidateDraftFieldsSchema,
  uncertain: z.array(candidateFieldsSchema.keyof()),
});
export type CandidateDraft = z.output<typeof candidateDraftSchema>;

export const CANDIDATE_FIELD_KEYS = Object.keys(
  candidateFieldsSchema.shape,
) as CandidateFieldKey[];

export const CANDIDATE_ARRAY_FIELD_KEYS = [
  "educationAndTraining",
  "workExperience",
  "skillsAndCompetences",
  "additionalLanguages",
] as const satisfies readonly CandidateFieldKey[];

export const CANDIDATE_BOOLEAN_FIELD_KEYS = [
  "workingPermit",
  "drivingLicense",
  "partTimePreference",
] as const satisfies readonly CandidateFieldKey[];

export function isArrayFieldKey(
  key: CandidateFieldKey,
): key is (typeof CANDIDATE_ARRAY_FIELD_KEYS)[number] {
  return (CANDIDATE_ARRAY_FIELD_KEYS as readonly string[]).includes(key);
}

/** All-empty draft fields (null scalars, [] lists): the manual form's start. */
export function emptyCandidateDraftFields(): CandidateDraftFields {
  const out: Record<string, null | string[]> = {};
  for (const key of CANDIDATE_FIELD_KEYS) out[key] = isArrayFieldKey(key) ? [] : null;
  return out as CandidateDraftFields;
}
