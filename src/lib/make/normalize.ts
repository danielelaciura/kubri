import type { MakeDataStoreRecord } from "./types";
import type { Candidate, Channel } from "@/types";
import type { Prisma } from "@/generated/prisma/client";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";
import type { MakeCandidateWebhookPayload } from "@/lib/validations/webhook-candidate";
import { geocodeFromAddress } from "@/lib/geo/proximity";

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
    // Legacy Make-only path: no Postgres UUID available here. The normalizer
    // is being phased out; consumers that need dbId should not go through it.
    dbId: "",
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
    latitude: nullableNumber(d["lat"]),
    longitude: nullableNumber(d["lng"]),
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

function nullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
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
  pool: Pool,
): Prisma.CandidateUncheckedCreateInput {
  const d = payload.data;
  const jp = (d["job_preferences"] ?? {}) as Record<string, unknown>;

  // Prefer lat/lng explicitly sent by Make. If Make didn't include them but
  // we have a parseable address, geocode the comune locally via ISTAT data.
  const address = nullableString(d["address"]);
  let latitude = nullableNumber(d["lat"]);
  let longitude = nullableNumber(d["lng"]);
  if ((latitude == null || longitude == null) && address) {
    const fallback = geocodeFromAddress(address);
    if (fallback) {
      latitude = fallback.latitude;
      longitude = fallback.longitude;
    }
  }

  return {
    externalId: payload.key,
    poolId: pool.id,

    firstName: nullableString(d["first_name"]),
    lastName: nullableString(d["last_name"]),
    birthday: nullableString(d["birthday"]),
    countryOfOrigin: nullableString(d["country"]),
    address,
    latitude,
    longitude,
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

    interviewLanguage: nullableString(d["interview_language"]),
    sourceOrganization: nullableString(d["source_organization"]),
    channel: deriveChannelOrNull(d["source_organization"]),

    rawPayload: payload as unknown as Prisma.InputJsonValue,

    sourceUpdatedAt: parseNullableDate(d["last_updated"]),
  };
}
