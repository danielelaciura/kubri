import { describe, it, expect } from "vitest";
import {
  CANDIDATE_ARRAY_FIELD_KEYS,
  CANDIDATE_FIELD_KEYS,
  candidateDraftFieldsSchema,
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

describe("lenient draft vs strict form", () => {
  it("draft truncates an over-long text field", () => {
    const r = candidateDraftFieldsSchema.shape.jobConstraints.parse("x".repeat(1500));
    expect(r).toHaveLength(1000);
  });

  it("draft truncates long list entries and caps list length", () => {
    expect(candidateDraftFieldsSchema.shape.workExperience.parse(["x".repeat(800)])[0]).toHaveLength(500);
    const skills = Array.from({ length: 60 }, (_, i) => `s${i}`);
    expect(candidateDraftFieldsSchema.shape.skillsAndCompetences.parse(skills)).toHaveLength(50);
  });

  it("draft still rejects an invalid email", () => {
    expect(candidateDraftFieldsSchema.shape.email.safeParse("x").success).toBe(false);
  });

  it("form stays strict on over-long entries", () => {
    expect(
      candidateFieldsSchema.safeParse({ ...VALID, workExperience: ["x".repeat(501)] }).success,
    ).toBe(false);
  });
});
