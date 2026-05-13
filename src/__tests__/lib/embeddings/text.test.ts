import { describe, it, expect } from "vitest";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

describe("buildCandidateEmbeddingText", () => {
  it("joins all five populated fields with newlines", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["HACCP", "cucina"],
      workExperience: ["3 anni in pizzeria"],
      educationAndTraining: ["diploma alberghiero"],
      desiredJob: "aiuto cuoco",
      jobConstraints: "no turni notturni",
    });
    expect(text).toBe(
      [
        "HACCP, cucina",
        "3 anni in pizzeria",
        "diploma alberghiero",
        "aiuto cuoco",
        "no turni notturni",
      ].join("\n"),
    );
  });

  it("omits empty arrays and empty strings", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: [],
      workExperience: ["magazzino"],
      educationAndTraining: [],
      desiredJob: "",
      jobConstraints: null,
    });
    expect(text).toBe("magazzino");
  });

  it("returns empty string when nothing is populated", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: [],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    });
    expect(text).toBe("");
  });

  it("trims and skips blank strings within arrays", () => {
    const text = buildCandidateEmbeddingText({
      skillsAndCompetences: ["  ", "pulizie", ""],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: null,
      jobConstraints: null,
    });
    expect(text).toBe("pulizie");
  });
});

describe("buildJobDescriptionEmbeddingText", () => {
  it("joins name, description and skills", () => {
    const text = buildJobDescriptionEmbeddingText({
      name: "Cameriere weekend",
      description: "Servizio sala in ristorante centro",
      skills: ["sala", "italiano B1"],
    });
    expect(text).toBe(
      ["Cameriere weekend", "Servizio sala in ristorante centro", "sala, italiano B1"].join("\n"),
    );
  });

  it("omits empty skills array and empty description", () => {
    const text = buildJobDescriptionEmbeddingText({
      name: "Cuoco",
      description: "",
      skills: [],
    });
    expect(text).toBe("Cuoco");
  });
});
