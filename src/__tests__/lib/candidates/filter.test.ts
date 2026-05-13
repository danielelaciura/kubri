import { describe, it, expect } from "vitest";
import {
  filterCandidates,
  sortCandidates,
  paginateCandidates,
} from "@/lib/candidates/filter";
import type { Candidate } from "@/types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "1",
    dbId: "00000000-0000-0000-0000-000000000000",
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
    workExperience: ["Cameriere - Servizio ai tavoli"],
    skillsAndCompetences: ["Cameriere", "Barista"],
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
    latitude: null,
    longitude: null,
    createdAt: new Date("2025-01-15"),
    updatedAt: new Date("2025-01-15"),
    ...overrides,
  };
}

const candidates: Candidate[] = [
  makeCandidate({
    id: "1",
    dbId: "00000000-0000-0000-0000-000000000000",
    firstName: "Mario",
    lastName: "Rossi",
    countryOfOrigin: "Italiana",
    languages: { language: "Italiano", additionalLanguages: ["Inglese"] },
    skillsAndCompetences: ["Cameriere", "Barista"],
    workExperience: ["Cameriere - Servizio ai tavoli"],
    address: "Via Roma 1, Milano",
    createdAt: new Date("2025-01-15"),
  }),
  makeCandidate({
    id: "2",
    dbId: "00000000-0000-0000-0000-000000000000",
    firstName: "Ahmed",
    lastName: "Hassan",
    countryOfOrigin: "Egiziana",
    languages: { language: "Arabo", additionalLanguages: ["Italiano"] },
    skillsAndCompetences: ["Magazziniere", "Mulettista"],
    workExperience: ["Magazziniere - Gestione magazzino e logistica"],
    address: "Via Appia 2, Roma",
    createdAt: new Date("2025-02-10"),
  }),
  makeCandidate({
    id: "3",
    dbId: "00000000-0000-0000-0000-000000000000",
    firstName: "Fatima",
    lastName: "Diallo",
    countryOfOrigin: "Senegalese",
    languages: { language: "Francese", additionalLanguages: ["Wolof", "Italiano"] },
    skillsAndCompetences: ["Pulizie", "Cucina"],
    workExperience: ["Addetta pulizie - Pulizia uffici e ambienti"],
    address: "Via Po 3, Torino",
    createdAt: new Date("2025-03-01"),
  }),
  makeCandidate({
    id: "4",
    dbId: "00000000-0000-0000-0000-000000000000",
    firstName: "Li",
    lastName: "Wei",
    countryOfOrigin: "Cinese",
    languages: { language: "Cinese", additionalLanguages: ["Inglese"] },
    skillsAndCompetences: ["Cuoco", "Lavapiatti"],
    workExperience: ["Cuoco - Cucina cinese e italiana"],
    address: "Via Dante 4, milano",
    createdAt: new Date("2025-01-20"),
  }),
  makeCandidate({
    id: "5",
    dbId: "00000000-0000-0000-0000-000000000000",
    firstName: "Ana",
    lastName: "Popescu",
    countryOfOrigin: "Rumena",
    languages: { language: "Rumeno", additionalLanguages: ["Italiano", "Inglese"] },
    skillsAndCompetences: ["Cameriera", "Receptionist"],
    workExperience: ["Receptionist - Accoglienza clienti in hotel"],
    address: "Piazza Duomo 5, Firenze",
    createdAt: new Date("2025-02-25"),
  }),
];

describe("filterCandidates", () => {
  it("returns all candidates when filters are empty", () => {
    const result = filterCandidates(candidates, {});
    expect(result).toHaveLength(5);
  });

  it("filters by language", () => {
    const result = filterCandidates(candidates, {
      languages: ["Inglese"],
    });
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(["1", "4", "5"]);
  });

  it("filters by any of multiple languages", () => {
    const result = filterCandidates(candidates, {
      languages: ["Francese", "Arabo"],
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["2", "3"]);
  });

  it("filters by city (substring of address) case-insensitive", () => {
    const result = filterCandidates(candidates, { city: "milan" });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["1", "4"]);
  });

  it("filters by countryOfOrigin case-insensitive partial match", () => {
    const result = filterCandidates(candidates, { countryOfOrigin: "ital" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("filters by date range (dateFrom)", () => {
    const result = filterCandidates(candidates, {
      dateFrom: new Date("2025-02-01"),
    });
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(["2", "3", "5"]);
  });

  it("filters by date range (dateTo)", () => {
    const result = filterCandidates(candidates, {
      dateTo: new Date("2025-01-31"),
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["1", "4"]);
  });

  it("filters by date range (dateFrom + dateTo)", () => {
    const result = filterCandidates(candidates, {
      dateFrom: new Date("2025-02-01"),
      dateTo: new Date("2025-02-28"),
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["2", "5"]);
  });

  it("full-text search across firstName", () => {
    const result = filterCandidates(candidates, { search: "mario" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("1");
  });

  it("full-text search across skillsAndCompetences", () => {
    const result = filterCandidates(candidates, { search: "cuoco" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("4");
  });

  it("full-text search across workExperience", () => {
    const result = filterCandidates(candidates, { search: "logistica" });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("2");
  });

  it("combines multiple filters (AND logic)", () => {
    const result = filterCandidates(candidates, {
      languages: ["Italiano"],
      city: "milan",
    });
    // Only id 1 has "Italiano" AND address containing "milan"
    // (id 4's address is "Via Dante 4, milano" but its languages are Cinese + Inglese)
    expect(result).toHaveLength(1);
    expect(result.map((c) => c.id)).toEqual(["1"]);
  });
});

describe("sortCandidates", () => {
  it("sorts by firstName ascending", () => {
    const result = sortCandidates([...candidates], {
      field: "firstName",
      direction: "asc",
    });
    expect(result.map((c) => c.firstName)).toEqual([
      "Ahmed",
      "Ana",
      "Fatima",
      "Li",
      "Mario",
    ]);
  });

  it("sorts by firstName descending", () => {
    const result = sortCandidates([...candidates], {
      field: "firstName",
      direction: "desc",
    });
    expect(result.map((c) => c.firstName)).toEqual([
      "Mario",
      "Li",
      "Fatima",
      "Ana",
      "Ahmed",
    ]);
  });

  it("sorts by createdAt ascending", () => {
    const result = sortCandidates([...candidates], {
      field: "createdAt",
      direction: "asc",
    });
    expect(result.map((c) => c.id)).toEqual(["1", "4", "2", "5", "3"]);
  });

  it("sorts by createdAt descending", () => {
    const result = sortCandidates([...candidates], {
      field: "createdAt",
      direction: "desc",
    });
    expect(result.map((c) => c.id)).toEqual(["3", "5", "2", "4", "1"]);
  });
});

describe("paginateCandidates", () => {
  const items = Array.from({ length: 25 }, (_, i) => i + 1);

  it("returns page 1 of 10 items from 25", () => {
    const result = paginateCandidates(items, 1, 10);
    expect(result.data).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(result.total).toBe(25);
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(3);
  });

  it("returns page 3 (last partial page)", () => {
    const result = paginateCandidates(items, 3, 10);
    expect(result.data).toEqual([21, 22, 23, 24, 25]);
    expect(result.total).toBe(25);
    expect(result.page).toBe(3);
    expect(result.totalPages).toBe(3);
  });

  it("returns empty data for page beyond range", () => {
    const result = paginateCandidates(items, 5, 10);
    expect(result.data).toEqual([]);
    expect(result.total).toBe(25);
    expect(result.page).toBe(5);
    expect(result.totalPages).toBe(3);
  });

  it("calculates totalPages correctly", () => {
    expect(paginateCandidates(items, 1, 25).totalPages).toBe(1);
    expect(paginateCandidates(items, 1, 13).totalPages).toBe(2);
    expect(paginateCandidates(items, 1, 1).totalPages).toBe(25);
  });

  it("handles empty array", () => {
    const result = paginateCandidates([], 1, 10);
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalPages).toBe(0);
  });
});

describe("filterCandidates — proximity", () => {
  const milano = makeCandidate({ id: "milano", latitude: 45.4642, longitude: 9.19 });
  const torino = makeCandidate({ id: "torino", latitude: 45.07, longitude: 7.69 });
  const roma = makeCandidate({ id: "roma", latitude: 41.9, longitude: 12.5 });
  const noCoords = makeCandidate({ id: "nocoords", latitude: null, longitude: null });
  const all = [milano, torino, roma, noCoords];

  it("filters within radius around a known place", () => {
    const r = filterCandidates(all, { nearPlace: "Milano", radiusKm: 30 });
    expect(r.map((c) => c.id)).toEqual(["milano"]);
  });

  it("includes Torino when radius is 150 km from Milano", () => {
    const r = filterCandidates(all, { nearPlace: "Milano", radiusKm: 150 });
    expect(r.map((c) => c.id).sort()).toEqual(["milano", "torino"]);
  });

  it("excludes candidates with null coords when proximity active", () => {
    const r = filterCandidates(all, { nearPlace: "Milano", radiusKm: 10000 });
    expect(r.map((c) => c.id)).not.toContain("nocoords");
  });

  it("is a no-op when nearPlace cannot be resolved", () => {
    const r = filterCandidates(all, { nearPlace: "Nowhereville", radiusKm: 50 });
    expect(r).toHaveLength(all.length);
  });
});
