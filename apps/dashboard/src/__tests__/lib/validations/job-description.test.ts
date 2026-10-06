import { describe, it, expect } from "vitest";
import { jobDescriptionInputSchema } from "@/lib/validations/job-description";

describe("jobDescriptionInputSchema", () => {
  const valid = {
    name: "Addetto pulizie",
    locationRaw: "Milano",
    description: "Cerchiamo personale per pulizie di uffici e ambienti industriali.",
    skills: ["pulizie", "attenzione ai dettagli"],
  };

  it("accepts a valid input", () => {
    const r = jobDescriptionInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects description shorter than 20 chars", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, description: "troppo breve" });
    expect(r.success).toBe(false);
  });

  it("rejects empty location", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, locationRaw: "   " });
    expect(r.success).toBe(false);
  });

  it("accepts empty skills array", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, skills: [] });
    expect(r.success).toBe(true);
  });

  it("trims and filters empty skills", () => {
    const r = jobDescriptionInputSchema.safeParse({
      ...valid,
      skills: ["  pulizie  ", "", "  "],
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.skills).toEqual(["pulizie"]);
  });

  it("caps skills at 30 entries", () => {
    const skills = Array.from({ length: 31 }, (_, i) => `s${i}`);
    const r = jobDescriptionInputSchema.safeParse({ ...valid, skills });
    expect(r.success).toBe(false);
  });

  it("caps name at 120 chars", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "x".repeat(121) });
    expect(r.success).toBe(false);
  });

  it("defaults searchRadiusKm to 25 when omitted", () => {
    const r = jobDescriptionInputSchema.safeParse(valid);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.searchRadiusKm).toBe(25);
  });

  it("accepts a custom searchRadiusKm in range", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: 50 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.searchRadiusKm).toBe(50);
  });

  it("coerces searchRadiusKm from string", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: "75" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.searchRadiusKm).toBe(75);
  });

  it("rejects searchRadiusKm below MIN_RADIUS_KM", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: 0 });
    expect(r.success).toBe(false);
  });

  it("rejects searchRadiusKm above MAX_RADIUS_KM", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, searchRadiusKm: 201 });
    expect(r.success).toBe(false);
  });

  it("normalizes the name casing", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "  OPERATORE   MAGAZZINO " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Operatore magazzino");
  });

  it("keeps acronyms in a mixed-case name", () => {
    const r = jobDescriptionInputSchema.safeParse({ ...valid, name: "Operatore OSS Notturno" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Operatore OSS notturno");
  });
});
