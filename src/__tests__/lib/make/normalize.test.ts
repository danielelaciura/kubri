import { describe, it, expect } from "vitest";
import { normalizeCandidate, normalizeCandidates } from "@/lib/make/normalize";
import type { MakeDataStoreRecord } from "@/lib/make/types";

function makeCompleteRecord(overrides: Partial<MakeDataStoreRecord> = {}): MakeDataStoreRecord {
  return {
    id: "rec-123",
    name: "Mario Rossi",
    nationality: "Italian",
    languages: ["Italian", "English"],
    skills: ["cooking", "cleaning"],
    work_experiences: [
      { role: "Waiter", description: "Served tables at a restaurant", duration: "2 years" },
    ],
    availability: "immediate",
    city: "Milan",
    flow_control: { status: "completed" },
    interview_transcript: [
      { question: "What is your name?", answer: "Mario Rossi" },
    ],
    channel: "telegram",
    created_at: "2025-01-15T10:00:00Z",
    updated_at: "2025-01-15T12:00:00Z",
    ...overrides,
  };
}

describe("normalizeCandidate", () => {
  it("produces correct Candidate from a complete valid record", () => {
    const raw = makeCompleteRecord();
    const result = normalizeCandidate(raw);

    expect(result.id).toBe("rec-123");
    expect(result.name).toBe("Mario Rossi");
    expect(result.nationality).toBe("Italian");
    expect(result.languages).toEqual(["Italian", "English"]);
    expect(result.skills).toEqual(["cooking", "cleaning"]);
    expect(result.workExperiences).toEqual([
      { role: "Waiter", description: "Served tables at a restaurant", duration: "2 years" },
    ]);
    expect(result.availability).toBe("immediate");
    expect(result.city).toBe("Milan");
    expect(result.interviewTranscript).toEqual([
      { question: "What is your name?", answer: "Mario Rossi" },
    ]);
    expect(result.channel).toBe("telegram");
    expect(result.createdAt).toEqual(new Date("2025-01-15T10:00:00Z"));
    expect(result.updatedAt).toEqual(new Date("2025-01-15T12:00:00Z"));
  });

  it("uses defaults for missing optional fields", () => {
    const raw: MakeDataStoreRecord = { id: "rec-456" };
    const result = normalizeCandidate(raw);

    expect(result.id).toBe("rec-456");
    expect(result.name).toBe("");
    expect(result.nationality).toBe("");
    expect(result.languages).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.workExperiences).toEqual([]);
    expect(result.availability).toBe("other");
    expect(result.city).toBe("");
    expect(result.interviewTranscript).toEqual([]);
    expect(result.channel).toBe("telegram");
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.updatedAt).toBeInstanceOf(Date);
  });

  it("splits comma-separated languages string into array", () => {
    const raw = makeCompleteRecord({ languages: "Italian, English, French" });
    const result = normalizeCandidate(raw);
    expect(result.languages).toEqual(["Italian", "English", "French"]);
  });

  it("passes through languages when already an array", () => {
    const raw = makeCompleteRecord({ languages: ["Spanish", "Portuguese"] });
    const result = normalizeCandidate(raw);
    expect(result.languages).toEqual(["Spanish", "Portuguese"]);
  });

  it("uses defaults for null/undefined values", () => {
    const raw = makeCompleteRecord({
      name: undefined,
      nationality: undefined,
      languages: undefined,
      skills: undefined,
      city: undefined,
    });
    const result = normalizeCandidate(raw);

    expect(result.name).toBe("");
    expect(result.nationality).toBe("");
    expect(result.languages).toEqual([]);
    expect(result.skills).toEqual([]);
    expect(result.city).toBe("");
  });

  it("parses work_experiences from JSON string", () => {
    const experiences = [
      { role: "Cook", description: "Kitchen work", duration: "1 year" },
    ];
    const raw = makeCompleteRecord({ work_experiences: JSON.stringify(experiences) as unknown as string });
    const result = normalizeCandidate(raw);
    expect(result.workExperiences).toEqual(experiences);
  });

  it("splits comma-separated skills string into array", () => {
    const raw = makeCompleteRecord({ skills: "cooking, cleaning, driving" });
    const result = normalizeCandidate(raw);
    expect(result.skills).toEqual(["cooking", "cleaning", "driving"]);
  });
});

describe("normalizeCandidates", () => {
  it("normalizes multiple records", () => {
    const records: MakeDataStoreRecord[] = [
      makeCompleteRecord({ id: "rec-1", name: "Alice" }),
      makeCompleteRecord({ id: "rec-2", name: "Bob" }),
    ];
    const results = normalizeCandidates(records);
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe("rec-1");
    expect(results[0].name).toBe("Alice");
    expect(results[1].id).toBe("rec-2");
    expect(results[1].name).toBe("Bob");
  });

  it("returns empty array for empty input", () => {
    expect(normalizeCandidates([])).toEqual([]);
  });
});
