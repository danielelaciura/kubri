import { describe, it, expect } from "vitest";
import { normalizeCandidate, normalizeCandidates } from "@/lib/make/normalize";
import type { MakeDataStoreRecord, MakeRecordData } from "@/lib/make/types";

function makeCompleteRecord(
  dataOverrides: Partial<MakeRecordData> = {},
  keyOverride?: string,
): MakeDataStoreRecord {
  const data: MakeRecordData = {
    key: keyOverride ?? "rec-123",
    first_name: "Mario",
    last_name: "Rossi",
    birthday: "1990-05-15",
    country: "Italy",
    address: "Via Roma 1, Milano",
    phone: "+39 333 1234567",
    legal_status: "citizen",
    working_permit: true,
    transport: "car",
    education_and_training: ["High school"],
    work_experience: ["Waiter at Trattoria"],
    skills_and_competences: ["cooking", "cleaning"],
    language: "Italian",
    additional_languages: ["English", "French"],
    driving_license: true,
    job_preferences: {
      preferred_job: "Waiter",
      part_time_preference: false,
      preferred_location: "Milano",
      constraints: "",
      has_desired_job_experience: "yes",
    },
    centro_per_impiego: "CPI Milano",
    interview_language: "it",
    source_organization: "Telegram Bot",
    consent: true,
    cvPdfLink: "https://example.com/cv.pdf",
    cvDocLink: "https://example.com/cv.doc",
    last_updated: "2025-01-15T12:00:00Z",
    ...dataOverrides,
  };

  return {
    key: keyOverride ?? "rec-123",
    data,
  };
}

describe("normalizeCandidate", () => {
  it("produces correct Candidate from a complete valid record", () => {
    const raw = makeCompleteRecord();
    const result = normalizeCandidate(raw);

    expect(result.id).toBe("rec-123");
    expect(result.firstName).toBe("Mario");
    expect(result.lastName).toBe("Rossi");
    expect(result.dateOfBirth).toBe("1990-05-15");
    expect(result.countryOfOrigin).toBe("Italy");
    expect(result.address).toBe("Via Roma 1, Milano");
    expect(result.phone).toBe("+39 333 1234567");
    expect(result.legalStatus).toBe("citizen");
    expect(result.workingPermit).toBe(true);
    expect(result.drivingLicense).toBe(true);
    expect(result.meanOfTransport).toBe("car");
    expect(result.educationAndTraining).toEqual(["High school"]);
    expect(result.workExperience).toEqual(["Waiter at Trattoria"]);
    expect(result.skillsAndCompetences).toEqual(["cooking", "cleaning"]);
    expect(result.languages.language).toBe("Italian");
    expect(result.languages.additionalLanguages).toEqual(["English", "French"]);
    expect(result.jobPreferences.desiredJob).toBe("Waiter");
    expect(result.jobPreferences.partTimePreference).toBe(false);
    expect(result.jobPreferences.preferredLocation).toBe("Milano");
    expect(result.jobPreferences.hasDesiredJobExperience).toBe("yes");
    expect(result.centroPerImpiego).toBe("CPI Milano");
    expect(result.interviewLanguage).toBe("it");
    expect(result.sourceOrganization).toBe("Telegram Bot");
    expect(result.channel).toBe("telegram");
    expect(result.consent).toBe(true);
    expect(result.cvPdfLink).toBe("https://example.com/cv.pdf");
    expect(result.cvDocLink).toBe("https://example.com/cv.doc");
    expect(result.createdAt).toEqual(new Date("2025-01-15T12:00:00Z"));
    expect(result.updatedAt).toEqual(new Date("2025-01-15T12:00:00Z"));
  });

  it("uses defaults for missing optional fields", () => {
    const raw: MakeDataStoreRecord = { key: "rec-456", data: { key: "rec-456" } };
    const result = normalizeCandidate(raw);

    expect(result.id).toBe("rec-456");
    expect(result.firstName).toBe("");
    expect(result.lastName).toBe("");
    expect(result.countryOfOrigin).toBe("");
    expect(result.address).toBe("");
    expect(result.phone).toBe("");
    expect(result.workingPermit).toBe(false);
    expect(result.drivingLicense).toBe(false);
    expect(result.educationAndTraining).toEqual([]);
    expect(result.workExperience).toEqual([]);
    expect(result.skillsAndCompetences).toEqual([]);
    expect(result.languages.language).toBe("");
    expect(result.languages.additionalLanguages).toEqual([]);
    expect(result.jobPreferences.desiredJob).toBe("");
    expect(result.jobPreferences.partTimePreference).toBe(false);
    expect(result.consent).toBe(false);
    expect(result.channel).toBe("telegram");
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it("derives whatsapp channel from source_organization containing 'whatsapp'", () => {
    const raw = makeCompleteRecord({ source_organization: "WhatsApp Bot" });
    const result = normalizeCandidate(raw);
    expect(result.channel).toBe("whatsapp");
  });

  it("defaults channel to telegram when source_organization is missing", () => {
    const raw = makeCompleteRecord({ source_organization: undefined });
    const result = normalizeCandidate(raw);
    expect(result.channel).toBe("telegram");
  });

  it("passes through additional_languages when already an array", () => {
    const raw = makeCompleteRecord({ additional_languages: ["Spanish", "Portuguese"] });
    const result = normalizeCandidate(raw);
    expect(result.languages.additionalLanguages).toEqual(["Spanish", "Portuguese"]);
  });

  it("returns empty array when additional_languages is not an array", () => {
    const raw = makeCompleteRecord({
      additional_languages: "Spanish, Portuguese" as unknown as string[],
    });
    const result = normalizeCandidate(raw);
    expect(result.languages.additionalLanguages).toEqual([]);
  });

  it("uses defaults for null/undefined values", () => {
    const raw = makeCompleteRecord({
      first_name: undefined,
      last_name: undefined,
      country: undefined,
      address: undefined,
      skills_and_competences: undefined,
      working_permit: undefined,
      driving_license: undefined,
    });
    const result = normalizeCandidate(raw);

    expect(result.firstName).toBe("");
    expect(result.lastName).toBe("");
    expect(result.countryOfOrigin).toBe("");
    expect(result.address).toBe("");
    expect(result.skillsAndCompetences).toEqual([]);
    expect(result.workingPermit).toBe(false);
    expect(result.drivingLicense).toBe(false);
  });

  it("coerces boolean working_permit and driving_license", () => {
    const rawTrue = makeCompleteRecord({ working_permit: true, driving_license: true });
    expect(normalizeCandidate(rawTrue).workingPermit).toBe(true);
    expect(normalizeCandidate(rawTrue).drivingLicense).toBe(true);

    const rawFalse = makeCompleteRecord({ working_permit: false, driving_license: false });
    expect(normalizeCandidate(rawFalse).workingPermit).toBe(false);
    expect(normalizeCandidate(rawFalse).drivingLicense).toBe(false);
  });

  it("returns false for non-boolean working_permit / driving_license", () => {
    const raw = makeCompleteRecord({
      working_permit: "yes" as unknown as boolean,
      driving_license: 1 as unknown as boolean,
    });
    const result = normalizeCandidate(raw);
    expect(result.workingPermit).toBe(false);
    expect(result.drivingLicense).toBe(false);
  });

  it("uses current date when last_updated is missing or invalid", () => {
    const raw = makeCompleteRecord({ last_updated: undefined });
    const before = Date.now();
    const result = normalizeCandidate(raw);
    const after = Date.now();
    expect(result.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.createdAt.getTime()).toBeLessThanOrEqual(after);
  });
});

describe("normalizeCandidates", () => {
  it("normalizes multiple records", () => {
    const records: MakeDataStoreRecord[] = [
      makeCompleteRecord({ first_name: "Alice" }, "rec-1"),
      makeCompleteRecord({ first_name: "Bob" }, "rec-2"),
    ];
    const results = normalizeCandidates(records);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("rec-1");
    expect(results[0].firstName).toBe("Alice");
    expect(results[1].id).toBe("rec-2");
    expect(results[1].firstName).toBe("Bob");
  });

  it("returns empty array for empty input", () => {
    expect(normalizeCandidates([])).toEqual([]);
  });
});
