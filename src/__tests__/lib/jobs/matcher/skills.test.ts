import { describe, it, expect } from "vitest";
import { skillsScore } from "@/lib/jobs/matcher/skills";

describe("skillsScore", () => {
  it("returns 1.0 when all JD skills appear in candidate text", () => {
    const score = skillsScore({
      jdSkills: ["pulizie", "attenzione ai dettagli"],
      candidate: {
        skillsAndCompetences: ["pulizia", "attenzione al dettaglio"],
        workExperience: [],
        desiredJob: "",
      },
    });
    expect(score).toBeGreaterThan(0.8);
  });

  it("returns 0 when candidate has nothing in common", () => {
    const score = skillsScore({
      jdSkills: ["pulizie"],
      candidate: { skillsAndCompetences: ["finanza"], workExperience: [], desiredJob: "" },
    });
    expect(score).toBe(0);
  });

  it("uses synonym expansion (cleaning ↔ pulizie)", () => {
    const score = skillsScore({
      jdSkills: ["cleaning"],
      candidate: {
        skillsAndCompetences: [],
        workExperience: ["Operatore pulizie industriali"],
        desiredJob: "",
      },
    });
    expect(score).toBeGreaterThan(0.3);
  });

  it("matches the PRD example: 'Cleaning Staff' JD vs 'cleaning operator' candidate", () => {
    const score = skillsScore({
      jdSkills: [
        "conoscenza prodotti e tecniche di pulizia",
        "uso attrezzature",
        "precisione",
        "affidabilità",
      ],
      candidate: {
        skillsAndCompetences: ["pulizie", "precisione"],
        workExperience: ["Addetto pulizie in ambiente industriale"],
        desiredJob: "Cleaning operator",
      },
    });
    expect(score).toBeGreaterThan(0.3);
  });

  it("returns 0 when JD skills list is empty", () => {
    const score = skillsScore({
      jdSkills: [],
      candidate: { skillsAndCompetences: ["x"], workExperience: [], desiredJob: "" },
    });
    expect(score).toBe(0);
  });
});
