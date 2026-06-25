import { describe, it, expect } from "vitest";
import { mapAssessmentToCandidate } from "./mapping";

describe("mapAssessmentToCandidate", () => {
  it("routes profile answers into assessmentProfile by path", () => {
    const { assessmentProfile } = mapAssessmentToCandidate({ q1: "analitico", q3: 4 });
    expect(assessmentProfile).toMatchObject({ cognitive: { q1: "analitico", numeracy: 4 } });
  });
  it("appends column answers (experience → workExperience, skills)", () => {
    const { columns } = mapAssessmentToCandidate({
      esperienze: [{ ruolo: "cameriere", attivita: "servizio ai tavoli", skills_universali: ["Gestione del cliente"] }],
    });
    expect(columns.workExperience?.some((s) => s.includes("cameriere"))).toBe(true);
    expect(columns.skillsAndCompetences?.some((s) => s.includes("Gestione del cliente"))).toBe(true);
  });
  it("ignores unknown / empty answers", () => {
    const { columns, assessmentProfile } = mapAssessmentToCandidate({});
    expect(columns).toEqual({});
    expect(assessmentProfile).toEqual({});
  });
});
