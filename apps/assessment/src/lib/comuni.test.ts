import { describe, it, expect } from "vitest";
import { searchComuni, type Comune } from "./comuni";

const SAMPLE: Comune[] = [
  { nome: "Roma", sigla: "RM", lat: 41.89, lon: 12.48 },
  { nome: "Romagnano Sesia", sigla: "NO", lat: 45.62, lon: 8.39 },
  { nome: "Milano", sigla: "MI", lat: 45.46, lon: 9.19 },
  { nome: "Reggio Emilia", sigla: "RE", lat: 44.7, lon: 10.63 },
];

describe("searchComuni", () => {
  it("returns [] for a blank query", () => {
    expect(searchComuni("", SAMPLE)).toEqual([]);
    expect(searchComuni("  ", SAMPLE)).toEqual([]);
  });

  it("matches case- and accent-insensitively", () => {
    const r = searchComuni("ròma", SAMPLE);
    expect(r.map((c) => c.nome)).toContain("Roma");
  });

  it("ranks prefix matches before substring matches", () => {
    const r = searchComuni("rom", SAMPLE);
    expect(r[0]!.nome).toBe("Roma"); // prefix before 'Reggio'/substring
    expect(r.map((c) => c.nome)).toContain("Romagnano Sesia");
  });

  it("caps the number of results", () => {
    const many: Comune[] = Array.from({ length: 100 }, (_, i) => ({
      nome: `Borgo ${i}`, sigla: "XX", lat: 45, lon: 10,
    }));
    expect(searchComuni("borgo", many, 50).length).toBe(50);
  });
});
