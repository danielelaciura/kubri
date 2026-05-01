import type { MakeDataStoreRecord } from "./types";
import type { Candidate, Channel } from "@/types";
import type { Prisma } from "@/generated/prisma/client";
import type { MakeCandidateWebhookPayload } from "@/lib/validations/webhook-candidate";

function safeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function safeBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : false;
}

function safeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
}

function parseDate(value: unknown): Date {
  if (!value) return new Date();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

function deriveChannel(source: unknown): Channel {
  const s = safeString(source).toLowerCase();
  if (s.includes("whatsapp")) return "whatsapp";
  return "telegram";
}

export function normalizeCandidate(raw: MakeDataStoreRecord): Candidate {
  const d = raw.data;

  return {
    id: raw.key,
    firstName: safeString(d.first_name),
    lastName: safeString(d.last_name),
    dateOfBirth: safeString(d.birthday),
    countryOfOrigin: safeString(d.country),
    address: safeString(d.address),
    phone: safeString(d.phone),
    legalStatus: safeString(d.legal_status),
    workingPermit: safeBoolean(d.working_permit),
    meanOfTransport: safeString(d.transport),
    educationAndTraining: safeStringArray(d.education_and_training),
    workExperience: safeStringArray(d.work_experience),
    skillsAndCompetences: safeStringArray(d.skills_and_competences),
    languages: {
      language: safeString(d.language),
      additionalLanguages: safeStringArray(d.additional_languages),
    },
    drivingLicense: safeBoolean(d.driving_license),
    jobPreferences: {
      desiredJob: safeString(d.job_preferences?.preferred_job),
      partTimePreference: safeBoolean(d.job_preferences?.part_time_preference),
      preferredLocation: safeString(d.job_preferences?.preferred_location),
      constraints: safeString(d.job_preferences?.constraints),
      hasDesiredJobExperience: safeString(d.job_preferences?.has_desired_job_experience),
    },
    centroPerImpiego: safeString(d.centro_per_impiego),
    interviewLanguage: safeString(d.interview_language),
    sourceOrganization: safeString(d.source_organization),
    channel: deriveChannel(d.source_organization),
    consent: safeBoolean(d.consent),
    cvPdfLink: safeString(d.cvPdfLink),
    cvDocLink: safeString(d.cvDocLink),
    createdAt: parseDate(d.last_updated),
    updatedAt: parseDate(d.last_updated),
  };
}

export function normalizeCandidates(records: MakeDataStoreRecord[]): Candidate[] {
  return records.map(normalizeCandidate);
}

function nullableString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseNullableDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function deriveChannelOrNull(source: unknown): string | null {
  if (typeof source !== "string") return null;
  const s = source.toLowerCase();
  if (s.includes("whatsapp")) return "whatsapp";
  if (s.length > 0) return "telegram";
  return null;
}

export function normalizeForUpsert(
  payload: MakeCandidateWebhookPayload,
): Prisma.CandidateUncheckedCreateInput {
  const d = payload.data;
  const jp = (d["job_preferences"] ?? {}) as Record<string, unknown>;

  return {
    externalId: payload.key,
    makeDatastoreId: payload.makeDatastoreId,

    firstName: nullableString(d["first_name"]),
    lastName: nullableString(d["last_name"]),
    birthday: nullableString(d["birthday"]),
    countryOfOrigin: nullableString(d["country"]),
    address: nullableString(d["address"]),
    phone: nullableString(d["phone"]),

    workingPermit: nullableBoolean(d["working_permit"]),
    meanOfTransport: nullableString(d["transport"]),
    drivingLicense: nullableBoolean(d["driving_license"]),

    educationAndTraining: safeStringArray(d["education_and_training"]),
    workExperience: safeStringArray(d["work_experience"]),
    skillsAndCompetences: safeStringArray(d["skills_and_competences"]),

    language: nullableString(d["language"]),
    additionalLanguages: safeStringArray(d["additional_languages"]),
    italianLevel: nullableString(d["italian_level"]),

    desiredJob: nullableString(jp["preferred_job"]),
    partTimePreference: nullableBoolean(jp["part_time_preference"]),
    preferredLocation: nullableString(jp["preferred_location"]),
    jobConstraints: nullableString(jp["constraints"]),
    hasDesiredJobExperience: nullableString(jp["has_desired_job_experience"]),

    interviewLanguage: nullableString(d["language"]),
    sourceOrganization: nullableString(d["source_organization"]),
    channel: deriveChannelOrNull(d["source_organization"]),

    rawPayload: payload as unknown as Prisma.InputJsonValue,

    sourceUpdatedAt: parseNullableDate(d["last_updated"]),
  };
}
