import { describe, it, expect } from "vitest";
import { emptyCandidateDraftFields } from "@kubri/contracts";
import { contactFromDraft, landingContactSchema, mergeContactIntoDraft } from "@/lib/landing/contact";

const CONTACT = {
  firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567",
  email: "", privacyAccepted: true, shareWithGlobal: false,
};

describe("landingContactSchema", () => {
  it("accepts a valid contact and maps an empty email to null", () => {
    expect(landingContactSchema.parse(CONTACT).email).toBeNull();
  });
  it("lowercases the email", () => {
    expect(landingContactSchema.parse({ ...CONTACT, email: " A@B.IT " }).email).toBe("a@b.it");
  });
  it.each([
    ["missing consent", { privacyAccepted: false }],
    ["bad phone", { phone: "12" }],
    ["empty first name", { firstName: " " }],
    ["bad email", { email: "nope" }],
  ])("rejects %s", (_, patch) => {
    expect(landingContactSchema.safeParse({ ...CONTACT, ...patch }).success).toBe(false);
  });
});

describe("contactFromDraft", () => {
  it("reads the four contact fields from a stored draft", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), firstName: "Ahmed", phone: "333 1234567" },
    };
    expect(contactFromDraft(draft)).toEqual({ firstName: "Ahmed", lastName: "", phone: "333 1234567", email: "" });
  });
  it("returns empty values for a malformed draft", () => {
    expect(contactFromDraft({ nope: true })).toEqual({ firstName: "", lastName: "", phone: "", email: "" });
  });
});

describe("mergeContactIntoDraft", () => {
  it("overrides contact fields and keeps the rest of the draft", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), firstName: "A", workExperience: ["Magazziniere, 2020"] },
    };
    const fields = mergeContactIntoDraft(draft, landingContactSchema.parse(CONTACT));
    expect(fields).toMatchObject({
      firstName: "Ahmed", lastName: "Benali", phone: "+39 333 1234567", email: null,
      workExperience: ["Magazziniere, 2020"],
    });
  });

  it("truncates an oversized draft list (lenient draft schema) without failing", () => {
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), skillsAndCompetences: Array(60).fill("x") },
    };
    const fields = mergeContactIntoDraft(draft, landingContactSchema.parse(CONTACT));
    expect(fields.skillsAndCompetences).toHaveLength(50);
  });

  it("clears a value the strict schema rejects instead of failing", () => {
    // The draft schema already truncates, so strict-only failures can only come
    // from the merged contact: bypass landingContactSchema with an invalid email.
    const bad = { ...landingContactSchema.parse(CONTACT), email: "not-an-email" };
    const draft = {
      isCv: true, uncertain: [],
      fields: { ...emptyCandidateDraftFields(), workExperience: ["Magazziniere, 2020"] },
    };
    const fields = mergeContactIntoDraft(draft, bad);
    expect(fields.email).toBeNull();
    expect(fields.workExperience).toEqual(["Magazziniere, 2020"]);
    expect(fields.firstName).toBe("Ahmed");
  });

  it("works with a missing draft", () => {
    const fields = mergeContactIntoDraft(null, landingContactSchema.parse(CONTACT));
    expect(fields.firstName).toBe("Ahmed");
  });
});
