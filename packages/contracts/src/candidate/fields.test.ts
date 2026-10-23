import { describe, it, expect } from "vitest";
import {
  CANDIDATE_ARRAY_FIELD_KEYS,
  CANDIDATE_FIELD_KEYS,
  candidateDraftSchema,
  candidateFieldsSchema,
  emptyCandidateDraftFields,
} from "./fields";

const VALID = {
  firstName: " Ahmed ",
  lastName: "Benali",
  birthday: "",
  countryOfOrigin: "Marocco",
  address: null,
  location: "Milano (MI)",
  phone: "+39 345 1234567",
  email: " Ahmed@Example.com ",
  workingPermit: true,
  meanOfTransport: null,
  drivingLicense: null,
  educationAndTraining: ["Licenza media", ""],
  workExperience: ["Magazziniere, Amazon, 2022–2024"],
  skillsAndCompetences: [],
  language: "Arabo",
  additionalLanguages: ["Francese"],
  italianLevel: "B1",
  desiredJob: "Magazziniere",
  partTimePreference: null,
  preferredLocation: null,
  jobConstraints: null,
};

describe("candidateFieldsSchema", () => {
  it("trims, nulls empty strings, lowercases email, drops empty array items", () => {
    const r = candidateFieldsSchema.parse(VALID);
    expect(r.firstName).toBe("Ahmed");
    expect(r.birthday).toBeNull();
    expect(r.email).toBe("ahmed@example.com");
    expect(r.educationAndTraining).toEqual(["Licenza media"]);
  });

  it("requires first and last name", () => {
    expect(candidateFieldsSchema.safeParse({ ...VALID, lastName: "  " }).success).toBe(false);
  });

  it("rejects a malformed email", () => {
    expect(candidateFieldsSchema.safeParse({ ...VALID, email: "not-an-email" }).success).toBe(false);
  });
});

describe("candidateDraftSchema", () => {
  it("allows missing names in a draft and validates uncertain keys", () => {
    const r = candidateDraftSchema.parse({
      isCv: true,
      fields: { ...VALID, firstName: null, lastName: null },
      uncertain: ["italianLevel"],
    });
    expect(r.fields.firstName).toBeNull();
    expect(r.uncertain).toEqual(["italianLevel"]);
  });

  it("rejects unknown uncertain keys", () => {
    expect(
      candidateDraftSchema.safeParse({ isCv: true, fields: VALID, uncertain: ["nope"] }).success,
    ).toBe(false);
  });
});

describe("field keys", () => {
  it("lists every field and the array subset", () => {
    expect(CANDIDATE_FIELD_KEYS).toHaveLength(21);
    expect(CANDIDATE_ARRAY_FIELD_KEYS).toEqual([
      "educationAndTraining",
      "workExperience",
      "skillsAndCompetences",
      "additionalLanguages",
    ]);
  });

  it("empty draft fields are null / []", () => {
    const e = emptyCandidateDraftFields();
    expect(e.firstName).toBeNull();
    expect(e.workExperience).toEqual([]);
    expect(candidateDraftSchema.shape.fields.safeParse(e).success).toBe(true);
  });
});
