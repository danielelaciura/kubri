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

const sharedShape = {
  birthday: optText(40),
  countryOfOrigin: optText(100),
  address: optText(300),
  location: optText(200),
  phone: optText(40),
  email: optEmail,
  workingPermit: z.boolean().nullable(),
  meanOfTransport: optText(100),
  drivingLicense: z.boolean().nullable(),
  educationAndTraining: textList(30, 500),
  workExperience: textList(30, 500),
  skillsAndCompetences: textList(50, 200),
  language: optText(100),
  additionalLanguages: textList(20, 100),
  italianLevel: optText(50),
  desiredJob: optText(200),
  partTimePreference: z.boolean().nullable(),
  preferredLocation: optText(200),
  jobConstraints: optText(1000),
};

/**
 * Candidate profile fields as submitted from the dashboard form (and, later,
 * the public upload page). First and last name are required: the candidates
 * list hides rows without a last name.
 */
export const candidateFieldsSchema = z.object({
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  ...sharedShape,
});
export type CandidateFields = z.output<typeof candidateFieldsSchema>;
export type CandidateFieldsInput = z.input<typeof candidateFieldsSchema>;
export type CandidateFieldKey = keyof CandidateFields;

/** Same fields with names optional — what an LLM extraction can produce. */
export const candidateDraftFieldsSchema = z.object({
  firstName: optText(100),
  lastName: optText(100),
  ...sharedShape,
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
