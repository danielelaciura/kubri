import { describe, it, expect } from "vitest";
import { computeMatch, rankCandidates } from "@/lib/jobs/matcher";
import type { Candidate } from "@/types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  const base: Candidate = {
    id: "1",
    firstName: "Test",
    lastName: "Candidate",
    dateOfBirth: "",
    countryOfOrigin: "",
    address: "",
    phone: "",
    legalStatus: "",
    workingPermit: "",
    meanOfTransport: "",
    educationAndTraining: [],
    workExperience: [],
    skillsAndCompetences: [],
    languages: { language: "", additionalLanguages: [] },
    drivingLicense: "",
    jobPreferences: {
      desiredJob: "",
      partTimePreference: false,
      preferredLocation: "",
      constraints: "",
      hasDesiredJobExperience: "",
    },
    centroPerImpiego: "",
    interviewLanguage: "",
    sourceOrganization: "",
    channel: "telegram",
    consent: false,
    cvPdfLink: "",
    cvDocLink: "",
    createdAt: new Date("2026-04-01"),
    updatedAt: new Date("2026-04-01"),
  };
  return { ...base, ...overrides };
}

const jd = {
  name: "Addetto pulizie",
  description: "Azienda di pulizie cerca personale per sanificare ambienti residenziali e industriali. Richiesta precisione e affidabilità.",
  skills: [
    "Conoscenza prodotti e tecniche di pulizia",
    "Precisione e attenzione ai dettagli",
    "Affidabilità e puntualità",
  ],
  locationMunicipality: "Milano",
  locationProvince: "Milano",
  locationRegion: "Lombardia",
};

describe("computeMatch", () => {
  it("returns high score for PRD example (cleaning operator in Lombardia)", () => {
    const cand = makeCandidate({
      skillsAndCompetences: ["pulizie", "precisione", "affidabilità", "attenzione ai dettagli"],
      workExperience: ["Addetto pulizie in ambiente industriale"],
      jobPreferences: {
        desiredJob: "cleaning operator",
        partTimePreference: false,
        preferredLocation: "Lombardia",
        constraints: "",
        hasDesiredJobExperience: "",
      },
    });

    const result = computeMatch(jd, cand);
    expect(result.final).toBeGreaterThanOrEqual(55);
    expect(result.breakdown.skills).toBeGreaterThan(0);
    expect(result.breakdown.location).toBeCloseTo(0.6);
  });

  it("returns low score for unrelated candidate", () => {
    const cand = makeCandidate({
      skillsAndCompetences: ["finanza", "excel"],
      workExperience: ["Analista finanziario"],
      jobPreferences: {
        desiredJob: "controller",
        partTimePreference: false,
        preferredLocation: "Napoli",
        constraints: "",
        hasDesiredJobExperience: "",
      },
    });
    const result = computeMatch(jd, cand);
    expect(result.final).toBeLessThan(30);
  });
});

describe("rankCandidates", () => {
  it("returns sorted top N above threshold", () => {
    const candidates = [
      makeCandidate({ id: "good", skillsAndCompetences: ["pulizie", "precisione"], jobPreferences: { desiredJob: "addetto pulizie", partTimePreference: false, preferredLocation: "Milano", constraints: "", hasDesiredJobExperience: "" } }),
      makeCandidate({ id: "meh", skillsAndCompetences: ["magazziniere"] }),
      makeCandidate({ id: "bad", skillsAndCompetences: ["finanza"], jobPreferences: { desiredJob: "controller", partTimePreference: false, preferredLocation: "Napoli", constraints: "", hasDesiredJobExperience: "" } }),
    ];
    const ranked = rankCandidates(jd, candidates);
    expect(ranked[0]?.candidate.id).toBe("good");
    expect(ranked.map((r) => r.candidate.id)).not.toContain("bad");
  });

  it("falls back to top 10 when nothing clears threshold", () => {
    const candidates = Array.from({ length: 5 }, (_, i) =>
      makeCandidate({ id: String(i), skillsAndCompetences: ["finanza"] })
    );
    const ranked = rankCandidates(jd, candidates);
    expect(ranked.length).toBe(5);
    expect(ranked.every((r) => r.isFallback === true)).toBe(true);
  });
});
