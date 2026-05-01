import { describe, it, expect } from "vitest";
import { normalizeForUpsert } from "@/lib/make/normalize";
import type { PoolModel as Pool } from "@/generated/prisma/models/Pool";

const POOL: Pool = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Global",
  externalKey: "global",
  createdAt: new Date("2026-01-01T00:00:00Z"),
} as Pool;

describe("normalizeForUpsert", () => {
  it("maps a complete payload to Candidate upsert input", () => {
    const result = normalizeForUpsert(
      {
        key: "ext_123",
        externalKey: "global",
        data: {
          first_name: "Mario",
          last_name: "Rossi",
          birthday: "1995-03-12",
          country: "Italia",
          address: "Via Roma 1",
          lat: 45.4642,
          lng: 9.19,
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
      },
      POOL,
    );

    expect(result.externalId).toBe("ext_123");
    expect(result.poolId).toBe(POOL.id);
    expect(result.firstName).toBe("Mario");
    expect(result.lastName).toBe("Rossi");
    expect(result.birthday).toBe("1995-03-12");
    expect(result.countryOfOrigin).toBe("Italia");
    expect(result.italianLevel).toBe("B2");
    expect(result.latitude).toBe(45.4642);
    expect(result.longitude).toBe(9.19);
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
      externalKey: "global",
      data: expect.any(Object),
    });
  });

  it("returns null for missing scalar fields (not empty string)", () => {
    const result = normalizeForUpsert(
      {
        key: "k",
        externalKey: "global",
        data: {},
      },
      POOL,
    );
    expect(result.firstName).toBeNull();
    expect(result.lastName).toBeNull();
    expect(result.birthday).toBeNull();
    expect(result.latitude).toBeNull();
    expect(result.longitude).toBeNull();
    expect(result.italianLevel).toBeNull();
    expect(result.desiredJob).toBeNull();
    expect(result.partTimePreference).toBeNull();
    expect(result.educationAndTraining).toEqual([]);
    expect(result.additionalLanguages).toEqual([]);
    expect(result.sourceUpdatedAt).toBeNull();
  });

  it("derives channel=whatsapp when source_organization contains 'whatsapp'", () => {
    const result = normalizeForUpsert(
      {
        key: "k",
        externalKey: "global",
        data: { source_organization: "via WhatsApp Business" },
      },
      POOL,
    );
    expect(result.channel).toBe("whatsapp");
  });

  it("coerces partTimePreference from non-boolean to null", () => {
    const result = normalizeForUpsert(
      {
        key: "k",
        externalKey: "global",
        data: { job_preferences: { part_time_preference: "yes" } },
      },
      POOL,
    );
    expect(result.partTimePreference).toBeNull();
  });

  it("always stores the full payload in rawPayload", () => {
    const payload = {
      key: "k",
      externalKey: "global",
      data: { some_new_unknown_field: "value" },
    };
    const result = normalizeForUpsert(payload, POOL);
    expect(result.rawPayload).toEqual(payload);
  });

  it("parses last_updated into a Date for sourceUpdatedAt", () => {
    const result = normalizeForUpsert(
      {
        key: "k",
        externalKey: "global",
        data: { last_updated: "2026-04-24T15:32:11Z" },
      },
      POOL,
    );
    expect((result.sourceUpdatedAt as Date | null)?.toISOString()).toBe(
      "2026-04-24T15:32:11.000Z",
    );
  });

  it("returns null for sourceUpdatedAt when last_updated is invalid", () => {
    const result = normalizeForUpsert(
      {
        key: "k",
        externalKey: "global",
        data: { last_updated: "not-a-date" },
      },
      POOL,
    );
    expect(result.sourceUpdatedAt).toBeNull();
  });

  it("uses pool.id as poolId regardless of pool externalKey", () => {
    const altPool: Pool = {
      id: "00000000-0000-0000-0000-000000000099",
      name: "Other",
      externalKey: "tenant_a",
      createdAt: new Date(),
    } as Pool;
    const result = normalizeForUpsert(
      { key: "k", externalKey: "tenant_a", data: {} },
      altPool,
    );
    expect(result.poolId).toBe(altPool.id);
  });
});
