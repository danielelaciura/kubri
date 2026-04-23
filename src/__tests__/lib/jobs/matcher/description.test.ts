import { describe, it, expect } from "vitest";
import { descriptionScore } from "@/lib/jobs/matcher/description";

describe("descriptionScore", () => {
  it("matches when description keywords appear in candidate profile", () => {
    const score = descriptionScore({
      jdDescription: "Cerchiamo personale per pulizie e sanificazione di ambienti industriali.",
      candidate: {
        skillsAndCompetences: ["pulizie"],
        workExperience: ["Addetto alla sanificazione"],
        desiredJob: "operatore pulizie",
      },
    });
    expect(score).toBeGreaterThan(0.3);
  });

  it("returns 0 for totally unrelated descriptions", () => {
    const score = descriptionScore({
      jdDescription: "Sviluppatore React con esperienza backend.",
      candidate: {
        skillsAndCompetences: ["pulizie"],
        workExperience: ["Addetto pulizie"],
        desiredJob: "cameriere",
      },
    });
    expect(score).toBeLessThan(0.15);
  });

  it("returns 0 when JD description has no meaningful tokens", () => {
    const score = descriptionScore({
      jdDescription: "il la di",
      candidate: {
        skillsAndCompetences: ["pulizie"],
        workExperience: [],
        desiredJob: "",
      },
    });
    expect(score).toBe(0);
  });
});
