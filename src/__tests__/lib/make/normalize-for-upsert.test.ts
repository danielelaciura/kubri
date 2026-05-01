import { describe, it, expect } from "vitest";
import { normalizeForUpsert } from "@/lib/make/normalize";

describe("normalizeForUpsert", () => {
  it("maps a complete payload to Candidate upsert input", () => {
    const result = normalizeForUpsert({
      key: "ext_123",
      makeDatastoreId: "ds_abc",
      data: {
        first_name: "Mario",
        last_name: "Rossi",
        birthday: "1995-03-12",
        country: "Italia",
        address: "Via Roma 1",
        phone: "+39 333",
        working_permit: true,
        transport: "auto",
        driving_license: true,
        education_and_training: ["Liceo"],
        work_experience: ["Magazziniere 2y"],
        skills_and_competences: ["puntuale"],
        language: "italiano",
        additional_languages: ["inglese"],
        italian_level: "B2",
        job_preferences: {
          preferred_job: "magazziniere",
          part_time_preference: true,
          preferred_location: "Milano",
          constraints: "no notturni",
          has_desired_job_experience: "sì",
        },
        source_organization: "APL Milano",
        last_updated: "2026-04-24T15:32:11Z",
      },
    });

    expect(result.externalId).toBe("ext_123");
    expect(result.makeDatastoreId).toBe("ds_abc");
    expect(result.firstName).toBe("Mario");
    expect(result.lastName).toBe("Rossi");
    expect(result.birthday).toBe("1995-03-12");
    expect(result.countryOfOrigin).toBe("Italia");
    expect(result.italianLevel).toBe("B2");
    expect(result.workingPermit).toBe(true);
    expect(result.drivingLicense).toBe(true);
    expect(result.educationAndTraining).toEqual(["Liceo"]);
    expect(result.workExperience).toEqual(["Magazziniere 2y"]);
    expect(result.skillsAndCompetences).toEqual(["puntuale"]);
    expect(result.additionalLanguages).toEqual(["inglese"]);
    expect(result.desiredJob).toBe("magazziniere");
    expect(result.partTimePreference).toBe(true);
    expect(result.preferredLocation).toBe("Milano");
    expect(result.jobConstraints).toBe("no notturni");
    expect(result.hasDesiredJobExperience).toBe("sì");
    expect(result.sourceOrganization).toBe("APL Milano");
    expect(result.channel).toBe("telegram");
    expect(result.sourceUpdatedAt).toBeInstanceOf(Date);
    expect(result.rawPayload).toEqual({
      key: "ext_123",
      makeDatastoreId: "ds_abc",
      data: expect.any(Object),
    });
  });

  it("returns null for missing scalar fields (not empty string)", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: {},
    });
    expect(result.firstName).toBeNull();
    expect(result.lastName).toBeNull();
    expect(result.birthday).toBeNull();
    expect(result.italianLevel).toBeNull();
    expect(result.desiredJob).toBeNull();
    expect(result.partTimePreference).toBeNull();
    expect(result.educationAndTraining).toEqual([]);
    expect(result.additionalLanguages).toEqual([]);
    expect(result.sourceUpdatedAt).toBeNull();
  });

  it("derives channel=whatsapp when source_organization contains 'whatsapp'", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { source_organization: "via WhatsApp Business" },
    });
    expect(result.channel).toBe("whatsapp");
  });

  it("coerces partTimePreference from non-boolean to null", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { job_preferences: { part_time_preference: "yes" } },
    });
    expect(result.partTimePreference).toBeNull();
  });

  it("always stores the full payload in rawPayload", () => {
    const payload = {
      key: "k",
      makeDatastoreId: "ds",
      data: { some_new_unknown_field: "value" },
    };
    const result = normalizeForUpsert(payload);
    expect(result.rawPayload).toEqual(payload);
  });

  it("parses last_updated into a Date for sourceUpdatedAt", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { last_updated: "2026-04-24T15:32:11Z" },
    });
    expect(result.sourceUpdatedAt?.toISOString()).toBe("2026-04-24T15:32:11.000Z");
  });

  it("returns null for sourceUpdatedAt when last_updated is invalid", () => {
    const result = normalizeForUpsert({
      key: "k",
      makeDatastoreId: "ds",
      data: { last_updated: "not-a-date" },
    });
    expect(result.sourceUpdatedAt).toBeNull();
  });
});
