import { describe, it, expect } from "vitest";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

describe("buildCandidateEmbeddingText", () => {
  it("emits a labeled template with the desired role repeated at start and end", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["HACCP", "cucina"],
      workExperience: ["3 anni in pizzeria"],
      educationAndTraining: ["diploma alberghiero"],
      desiredJob: "aiuto cuoco",
      jobConstraints: "no turni notturni",
    });
    expect(text).toBe(
      [
        "RUOLO DESIDERATO: aiuto cuoco",
        "COMPETENZE: HACCP, cucina",
        "ESPERIENZA: 3 anni in pizzeria",
        "FORMAZIONE: diploma alberghiero",
        "VINCOLI: no turni notturni",
        "RUOLO DESIDERATO: aiuto cuoco",
      ].join("\n"),
    );
  });

  it("omits empty arrays and empty strings (and their labels)", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: [],
      workExperience: ["magazzino"],
      educationAndTraining: [],
      desiredJob: "",
      jobConstraints: null,
    });
    expect(text).toBe("ESPERIENZA: magazzino");
  });

  it("returns empty string when nothing is populated", () => {
    expect(
      buildCandidateEmbeddingText({
        skillsAndCompetences: [],
        workExperience: [],
        educationAndTraining: [],
        desiredJob: null,
        jobConstraints: null,
      }),
    ).toBe("");
  });

  it("trims and skips blank strings within arrays", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["  ", "pulizie", ""],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    });
    expect(text).toBe("COMPETENZE: pulizie");
  });

  it("does not duplicate the RUOLO DESIDERATO line when desiredJob is empty", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["pulizie"],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    });
    expect(text).toBe("COMPETENZE: pulizie");
    expect(text.match(/RUOLO DESIDERATO/g)).toBeNull();
  });
});

describe("buildJobDescriptionEmbeddingText", () => {
  it("emits a labeled template with the role title repeated at start and end", () => {
    const text = buildJobDescriptionEmbeddingText({
      name: "Cameriere weekend",
      description: "Servizio sala in ristorante centro",
      skills: ["sala", "italiano B1"],
    });
    expect(text).toBe(
      [
        "RUOLO: Cameriere weekend",
        "DESCRIZIONE: Servizio sala in ristorante centro",
        "COMPETENZE RICHIESTE: sala, italiano B1",
        "RUOLO: Cameriere weekend",
      ].join("\n"),
    );
  });

  it("omits empty skills array and empty description (and their labels)", () => {
    const text = buildJobDescriptionEmbeddingText({
      name: "Cuoco",
      description: "",
      skills: [],
    });
    expect(text).toBe("RUOLO: Cuoco\nRUOLO: Cuoco");
  });
});
