import type { MakeDataStoreRecord } from "./types";
import type { Candidate, Channel } from "@/types";

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
    workingPermit: safeString(d.working_permit),
    meanOfTransport: safeString(d.transport),
    educationAndTraining: safeStringArray(d.education_and_training),
    workExperience: safeStringArray(d.work_experience),
    skillsAndCompetences: safeStringArray(d.skills_and_competences),
    languages: {
      language: safeString(d.language),
      additionalLanguages: safeStringArray(d.additional_languages),
    },
    drivingLicense: safeString(d.driving_license),
    jobPreferences: {
      desiredJob: safeString(d.job_preferences?.desired_job),
      partTimePreference: safeBoolean(d.job_preferences?.part_time_preference),
      preferredLocation: safeString(d.job_preferences?.preferred_location),
      constraints: safeString(d.job_preferences?.constraints),
      hasDesiredJobExperience: safeString(d.job_preferences?.has_desired_job_experience),
    },
    centroPerImpiego: safeString(d.centro_per_impiego),
    interviewLanguage: safeString(d.language),
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
