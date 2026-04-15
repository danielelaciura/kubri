import { describe, it, expect } from "vitest";
import {
  filterCandidates,
  sortCandidates,
  paginateCandidates,
} from "@/lib/candidates/filter";
import type { Candidate, CandidateFilters, SortConfig } from "@/types";

function makeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "1",
    name: "Mario Rossi",
    nationality: "Italiana",
    languages: ["Italiano", "Inglese"],
    skills: ["Cameriere", "Barista"],
    workExperiences: [
      { role: "Cameriere", description: "Servizio ai tavoli" },
    ],
    availability: "immediate",
    city: "Milano",
    interviewTranscript: [],
    channel: "telegram",
    createdAt: new Date("2025-01-15"),
    updatedAt: new Date("2025-01-15"),
    ...overrides,
  };
}

const candidates: Candidate[] = [
  makeCandidate({
    id: "1",
    name: "Mario Rossi",
    nationality: "Italiana",
    languages: ["Italiano", "Inglese"],
    skills: ["Cameriere", "Barista"],
    workExperiences: [
      { role: "Cameriere", description: "Servizio ai tavoli" },
    ],
    availability: "immediate",
    city: "Milano",
    createdAt: new Date("2025-01-15"),
  }),
  makeCandidate({
    id: "2",
    name: "Ahmed Hassan",
    nationality: "Egiziana",
    languages: ["Arabo", "Italiano"],
    skills: ["Magazziniere", "Mulettista"],
    workExperiences: [
      { role: "Magazziniere", description: "Gestione magazzino e logistica" },
    ],
    availability: "within_1_month",
    city: "Roma",
    createdAt: new Date("2025-02-10"),
  }),
  makeCandidate({
    id: "3",
    name: "Fatima Diallo",
    nationality: "Senegalese",
    languages: ["Francese", "Wolof", "Italiano"],
    skills: ["Pulizie", "Cucina"],
    workExperiences: [
      { role: "Addetta pulizie", description: "Pulizia uffici e ambienti" },
    ],
    availability: "immediate",
    city: "Torino",
    createdAt: new Date("2025-03-01"),
  }),
  makeCandidate({
    id: "4",
    name: "Li Wei",
    nationality: "Cinese",
    languages: ["Cinese", "Inglese"],
    skills: ["Cuoco", "Lavapiatti"],
    workExperiences: [
      { role: "Cuoco", description: "Cucina cinese e italiana" },
    ],
    availability: "other",
    city: "milano",
    createdAt: new Date("2025-01-20"),
  }),
  makeCandidate({
    id: "5",
    name: "Ana Popescu",
    nationality: "Rumena",
    languages: ["Rumeno", "Italiano", "Inglese"],
    skills: ["Cameriera", "Receptionist"],
    workExperiences: [
      { role: "Receptionist", description: "Accoglienza clienti in hotel" },
    ],
    availability: "immediate",
    city: "Firenze",
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

  it("filters by city case-insensitive partial match", () => {
    const result = filterCandidates(candidates, { city: "milan" });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["1", "4"]);
  });

  it("filters by nationality case-insensitive partial match", () => {
    const result = filterCandidates(candidates, { nationality: "ital" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("filters by availability", () => {
    const result = filterCandidates(candidates, {
      availability: "immediate",
    });
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(["1", "3", "5"]);
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

  it("full-text search across name", () => {
    const result = filterCandidates(candidates, { search: "mario" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("full-text search across skills", () => {
    const result = filterCandidates(candidates, { search: "cuoco" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("4");
  });

  it("full-text search across work experiences", () => {
    const result = filterCandidates(candidates, { search: "logistica" });
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("combines multiple filters (AND logic)", () => {
    const result = filterCandidates(candidates, {
      availability: "immediate",
      languages: ["Italiano"],
    });
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.id)).toEqual(["1", "3"]);
  });
});

describe("sortCandidates", () => {
  it("sorts by name ascending", () => {
    const result = sortCandidates([...candidates], {
      field: "name",
      direction: "asc",
    });
    expect(result.map((c) => c.name)).toEqual([
      "Ahmed Hassan",
      "Ana Popescu",
      "Fatima Diallo",
      "Li Wei",
      "Mario Rossi",
    ]);
  });

  it("sorts by name descending", () => {
    const result = sortCandidates([...candidates], {
      field: "name",
      direction: "desc",
    });
    expect(result.map((c) => c.name)).toEqual([
      "Mario Rossi",
      "Li Wei",
      "Fatima Diallo",
      "Ana Popescu",
      "Ahmed Hassan",
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
