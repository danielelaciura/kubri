import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("@/lib/llm/client", () => ({
  chatCompletion: vi.fn(),
}));

import { chatCompletion } from "@/lib/llm/client";
import { rerankCandidates, _clearRerankCache } from "@/lib/llm/rerank";
import { LLMError } from "@/lib/llm/errors";
import type { Candidate } from "@/types";

function makeCandidate(id: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    id,
    dbId: "00000000-0000-0000-0000-000000000000",
    firstName: "Test",
    lastName: id,
    dateOfBirth: "",
    countryOfOrigin: "",
    address: "",
    phone: "",
    legalStatus: "",
    workingPermit: true,
    meanOfTransport: "",
    educationAndTraining: [],
    workExperience: [],
    skillsAndCompetences: [],
    languages: { language: "Italiano", additionalLanguages: [] },
    drivingLicense: true,
    jobPreferences: {
      desiredJob: "tester",
      partTimePreference: false,
      preferredLocation: "Milano",
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
    latitude: null,
    longitude: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const baseInput = {
  jd: { name: "Cuoco", description: "Cerco cuoco", skills: ["cucina"], locationMunicipality: "Roma" },
  candidates: [makeCandidate("c1"), makeCandidate("c2")],
};

describe("rerankCandidates", () => {
  beforeEach(() => {
    _clearRerankCache();
    vi.clearAllMocks();
  });
  afterEach(() => {
    _clearRerankCache();
  });

  it("returns enrichments parsed from a well-formed Mistral response", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({
        results: [
          { candidateId: "c1", score: 85, summary: "ok", matchedSkills: ["cucina"], missingSkills: [], redFlags: [] },
          { candidateId: "c2", score: 30, summary: "no", matchedSkills: [], missingSkills: ["cucina"], redFlags: ["off-topic"] },
        ],
      }),
    );

    const out = await rerankCandidates("jd-1", baseInput);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ candidateId: "c1", score: 85, summary: "ok" });
    expect(out[1]).toMatchObject({ candidateId: "c2", score: 30, redFlags: ["off-topic"] });
  });

  it("clamps scores into 0-100 and rounds non-integer values", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({
        results: [
          { candidateId: "c1", score: 150, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
          { candidateId: "c2", score: 72.6, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
        ],
      }),
    );
    const out = await rerankCandidates("jd-1", baseInput);
    expect(out[0]!.score).toBe(100);
    expect(out[1]!.score).toBe(73);
  });

  it("throws LLMError when the response is not valid JSON", async () => {
    vi.mocked(chatCompletion).mockResolvedValue("not json");
    await expect(rerankCandidates("jd-1", baseInput)).rejects.toBeInstanceOf(LLMError);
  });

  it("throws LLMError when results is missing", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(JSON.stringify({ foo: 1 }));
    await expect(rerankCandidates("jd-1", baseInput)).rejects.toBeInstanceOf(LLMError);
  });

  it("returns [] without calling the LLM when candidates is empty", async () => {
    const out = await rerankCandidates("jd-1", { ...baseInput, candidates: [] });
    expect(out).toEqual([]);
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("caches results so a second call within the TTL does not hit the LLM", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({
        results: [
          { candidateId: "c1", score: 85, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
          { candidateId: "c2", score: 30, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
        ],
      }),
    );
    await rerankCandidates("jd-1", baseInput);
    await rerankCandidates("jd-1", baseInput);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("treats a different JD id as a separate cache entry", async () => {
    vi.mocked(chatCompletion).mockResolvedValue(
      JSON.stringify({
        results: [
          { candidateId: "c1", score: 85, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
          { candidateId: "c2", score: 30, summary: "", matchedSkills: [], missingSkills: [], redFlags: [] },
        ],
      }),
    );
    await rerankCandidates("jd-1", baseInput);
    await rerankCandidates("jd-2", baseInput);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });
});
