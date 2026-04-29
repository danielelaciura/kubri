import { describe, it, expect } from "vitest";
import { candidatesToCsv } from "@/lib/export/csv";
import type { Candidate } from "@/types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "1",
    firstName: "Mario",
    lastName: "Rossi",
    dateOfBirth: "1990-05-15",
    countryOfOrigin: "Italiana",
    address: "Via Roma 1, Milano",
    phone: "+39 333 1234567",
    legalStatus: "citizen",
    workingPermit: true,
    meanOfTransport: "car",
    educationAndTraining: [],
    workExperience: [],
    skillsAndCompetences: ["Cucina", "Pulizie"],
    languages: {
      language: "Italiano",
      additionalLanguages: ["Inglese"],
    },
    drivingLicense: true,
    jobPreferences: {
      desiredJob: "Cameriere",
      partTimePreference: false,
      preferredLocation: "Milano",
      constraints: "",
      hasDesiredJobExperience: "yes",
    },
    centroPerImpiego: "",
    interviewLanguage: "it",
    sourceOrganization: "Telegram Bot",
    channel: "telegram",
    consent: true,
    cvPdfLink: "",
    cvDocLink: "",
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
      "Nome,Cognome,Data di nascita,Paese di origine,Indirizzo,Telefono,Stato legale,Permesso di lavoro,Lingua madre,Altre lingue,Competenze,Esperienze lavorative,Lavoro desiderato,Data,Canale",
    );
  });

  it("produces a correct row for a single candidate", () => {
    const csv = candidatesToCsv([makeCandidate()]);
    const lines = csv.replace("\uFEFF", "").split("\n");
    expect(lines).toHaveLength(2);
    const row = lines[1];
    expect(row).toContain("Mario");
    expect(row).toContain("Rossi");
    expect(row).toContain("Italiana");
    expect(row).toContain("Italiano");
    expect(row).toContain("Inglese");
    expect(row).toContain("Cucina; Pulizie");
    expect(row).toContain("Cameriere");
    expect(row).toContain("telegram");
  });

  it("renders workingPermit boolean as 'Sì' / 'No'", () => {
    const yes = candidatesToCsv([makeCandidate({ workingPermit: true })]);
    expect(yes).toContain("Sì");

    const no = candidatesToCsv([makeCandidate({ workingPermit: false })]);
    const lines = no.replace("\uFEFF", "").split("\n");
    expect(lines[1]).toContain(",No,");
  });

  it("escapes cells containing commas", () => {
    const csv = candidatesToCsv([
      makeCandidate({ address: "Via Roma 1, Milano" }),
    ]);
    expect(csv).toContain('"Via Roma 1, Milano"');
  });

  it("escapes cells containing double quotes", () => {
    const csv = candidatesToCsv([
      makeCandidate({ firstName: 'Mario "Il Grande"' }),
    ]);
    expect(csv).toContain('"Mario ""Il Grande"""');
  });

  it("escapes cells containing newlines", () => {
    const csv = candidatesToCsv([
      makeCandidate({ address: "Milano\nLombardia" }),
    ]);
    expect(csv).toContain('"Milano\nLombardia"');
  });

  it("preserves Italian/unicode characters", () => {
    const csv = candidatesToCsv([
      makeCandidate({
        firstName: "François",
        lastName: "Müller",
        countryOfOrigin: "Côte d'Ivoire",
        address: "São Paulo",
      }),
    ]);
    expect(csv).toContain("François");
    expect(csv).toContain("Müller");
    expect(csv).toContain("Côte d'Ivoire");
    expect(csv).toContain("São Paulo");
  });

  it("handles empty fields gracefully", () => {
    const csv = candidatesToCsv([
      makeCandidate({
        firstName: "",
        lastName: "",
        countryOfOrigin: "",
        languages: { language: "", additionalLanguages: [] },
        skillsAndCompetences: [],
        workExperience: [],
        address: "",
      }),
    ]);
    const lines = csv.replace("\uFEFF", "").split("\n");
    expect(lines).toHaveLength(2);
    // Should not throw and should produce a valid row with the expected number of columns
    const cells = lines[1]!.split(",");
    expect(cells.length).toBe(15);
  });

  it("produces correct rows for multiple candidates", () => {
    const candidates = [
      makeCandidate({ id: "1", firstName: "Mario", lastName: "Rossi" }),
      makeCandidate({ id: "2", firstName: "Anna", lastName: "Bianchi", address: "Roma" }),
      makeCandidate({ id: "3", firstName: "Luca", lastName: "Verdi" }),
    ];
    const csv = candidatesToCsv(candidates);
    const lines = csv.replace("\uFEFF", "").split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("Mario");
    expect(lines[1]).toContain("Rossi");
    expect(lines[2]).toContain("Anna");
    expect(lines[2]).toContain("Bianchi");
    expect(lines[2]).toContain("Roma");
    expect(lines[3]).toContain("Luca");
    expect(lines[3]).toContain("Verdi");
  });

  it("formats dates in Italian locale", () => {
    const csv = candidatesToCsv([
      makeCandidate({ createdAt: new Date("2025-12-25T12:00:00Z") }),
    ]);
    // Italian date format: DD/MM/YYYY
    expect(csv).toMatch(/25\/12\/2025/);
  });
});
