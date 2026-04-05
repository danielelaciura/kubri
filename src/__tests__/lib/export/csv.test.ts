import { describe, it, expect } from "vitest";
import { candidatesToCsv } from "@/lib/export/csv";
import type { Candidate } from "@/types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "1",
    name: "Mario Rossi",
    nationality: "Italiana",
    languages: ["Italiano", "Inglese"],
    skills: ["Cucina", "Pulizie"],
    workExperiences: [],
    availability: "immediate",
    city: "Milano",
    interviewStatus: "completed",
    interviewTranscript: [],
    channel: "telegram",
    createdAt: new Date("2025-06-15T10:00:00Z"),
    updatedAt: new Date("2025-06-15T10:00:00Z"),
    ...overrides,
  };
}

describe("candidatesToCsv", () => {
  it("includes UTF-8 BOM at start of output", () => {
    const csv = candidatesToCsv([]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("produces correct Italian column headers", () => {
    const csv = candidatesToCsv([]);
    const firstLine = csv.replace("\uFEFF", "").split("\n")[0];
    expect(firstLine).toBe(
      "Nome,Nazionalità,Lingue,Competenze,Disponibilità,Città,Stato intervista,Data,Canale"
    );
  });

  it("produces a correct row for a single candidate", () => {
    const csv = candidatesToCsv([makeCandidate()]);
    const lines = csv.replace("\uFEFF", "").split("\n");
    expect(lines).toHaveLength(2);
    // Check specific field values
    const row = lines[1];
    expect(row).toContain("Mario Rossi");
    expect(row).toContain("Italiana");
    expect(row).toContain("Italiano, Inglese");
    expect(row).toContain("Cucina, Pulizie");
    expect(row).toContain("Immediata");
    expect(row).toContain("Milano");
    expect(row).toContain("Completata");
    expect(row).toContain("telegram");
  });

  it("maps availability labels to Italian", () => {
    const immediate = candidatesToCsv([makeCandidate({ availability: "immediate" })]);
    expect(immediate).toContain("Immediata");

    const within1Month = candidatesToCsv([makeCandidate({ availability: "within_1_month" })]);
    expect(within1Month).toContain("Entro 1 mese");

    const other = candidatesToCsv([makeCandidate({ availability: "other" })]);
    expect(other).toContain("Altro");
  });

  it("maps interview status labels to Italian", () => {
    const completed = candidatesToCsv([makeCandidate({ interviewStatus: "completed" })]);
    expect(completed).toContain("Completata");

    const inProgress = candidatesToCsv([makeCandidate({ interviewStatus: "in_progress" })]);
    expect(inProgress).toContain("In corso");

    const abandoned = candidatesToCsv([makeCandidate({ interviewStatus: "abandoned" })]);
    expect(abandoned).toContain("Abbandonata");

    const incomplete = candidatesToCsv([makeCandidate({ interviewStatus: "incomplete" })]);
    expect(incomplete).toContain("Incompleta");
  });

  it("escapes cells containing commas", () => {
    const csv = candidatesToCsv([makeCandidate({ name: "Rossi, Mario" })]);
    expect(csv).toContain('"Rossi, Mario"');
  });

  it("escapes cells containing double quotes", () => {
    const csv = candidatesToCsv([makeCandidate({ name: 'Mario "Il Grande" Rossi' })]);
    expect(csv).toContain('"Mario ""Il Grande"" Rossi"');
  });

  it("escapes cells containing newlines", () => {
    const csv = candidatesToCsv([makeCandidate({ city: "Milano\nLombardia" })]);
    expect(csv).toContain('"Milano\nLombardia"');
  });

  it("preserves Italian/unicode characters", () => {
    const csv = candidatesToCsv([
      makeCandidate({
        name: "François Müller",
        nationality: "Côte d'Ivoire",
        city: "São Paulo",
      }),
    ]);
    expect(csv).toContain("François Müller");
    expect(csv).toContain("Côte d'Ivoire");
    expect(csv).toContain("São Paulo");
  });

  it("handles empty fields gracefully", () => {
    const csv = candidatesToCsv([
      makeCandidate({
        name: "",
        nationality: "",
        languages: [],
        skills: [],
        city: "",
      }),
    ]);
    const lines = csv.replace("\uFEFF", "").split("\n");
    expect(lines).toHaveLength(2);
    // Should not throw and should produce a valid row
    const cells = lines[1].split(",");
    expect(cells.length).toBeGreaterThanOrEqual(9);
  });

  it("produces correct rows for multiple candidates", () => {
    const candidates = [
      makeCandidate({ id: "1", name: "Mario Rossi" }),
      makeCandidate({ id: "2", name: "Anna Bianchi", city: "Roma" }),
      makeCandidate({ id: "3", name: "Luca Verdi", interviewStatus: "in_progress" }),
    ];
    const csv = candidatesToCsv(candidates);
    const lines = csv.replace("\uFEFF", "").split("\n");
    // 1 header + 3 data rows
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("Mario Rossi");
    expect(lines[2]).toContain("Anna Bianchi");
    expect(lines[2]).toContain("Roma");
    expect(lines[3]).toContain("Luca Verdi");
    expect(lines[3]).toContain("In corso");
  });

  it("formats dates in Italian locale", () => {
    const csv = candidatesToCsv([
      makeCandidate({ createdAt: new Date("2025-12-25T00:00:00Z") }),
    ]);
    // Italian date format: DD/MM/YYYY
    expect(csv).toMatch(/25\/12\/2025/);
  });
});
