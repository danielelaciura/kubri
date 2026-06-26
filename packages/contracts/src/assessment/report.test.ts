import { describe, it, expect } from "vitest";
import { assessmentReportSchema, DOMAIN_IDS, DOMAIN_LABELS } from "./report";

const VALID = {
  intro: "Profilo pratico e orientato alle persone.",
  domains: [
    { id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "Punto di forza" }] },
    { id: "relational", competences: [{ name: "Cura del cliente", level: "Buono", note: "Da esperienza" }] },
  ],
};

describe("assessmentReportSchema", () => {
  it("exposes the 5 fixed domains with Italian labels", () => {
    expect(DOMAIN_IDS).toHaveLength(5);
    expect(DOMAIN_LABELS.technical).toBe("Tecnico-operative");
  });

  it("accepts a valid report", () => {
    expect(assessmentReportSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a domain id outside the taxonomy", () => {
    const r = assessmentReportSchema.safeParse({
      ...VALID,
      domains: [{ id: "leadership", competences: [{ name: "X", level: "Forte", note: "" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a non-enum level", () => {
    const r = assessmentReportSchema.safeParse({
      ...VALID,
      domains: [{ id: "technical", competences: [{ name: "X", level: "Ottimo", note: "" }] }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a missing intro", () => {
    const { intro, ...rest } = VALID;
    expect(assessmentReportSchema.safeParse(rest).success).toBe(false);
  });
});
