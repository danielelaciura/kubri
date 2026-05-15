import type { Prisma } from "@/generated/prisma/client";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";
import type { MakeCandidateWebhookPayload } from "@/lib/validations/webhook-candidate";
import { geocodeFromAddress } from "@/lib/geo/proximity";

function safeStringArray(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean);
  }
  return [];
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
    channel: deriveChannelOrNull(d["channel"]),

    rawPayload: payload as unknown as Prisma.InputJsonValue,

    sourceUpdatedAt: parseNullableDate(d["last_updated"]),
  };
}
