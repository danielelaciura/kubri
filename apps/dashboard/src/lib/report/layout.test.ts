import { describe, it, expect } from "vitest";
import { computeReportLayout, MAX_LEAVES_PER_DOMAIN } from "./layout";
import type { AssessmentReport } from "@kubri/contracts";

function domain(id: AssessmentReport["domains"][number]["id"], n: number) {
  return { id, competences: Array.from({ length: n }, (_, i) => ({ name: `c${i}`, level: "Buono" as const, note: "" })) };
}

describe("computeReportLayout", () => {
  it("creates one node per domain plus the center", () => {
    const l = computeReportLayout([domain("technical", 2), domain("relational", 1)]);
    expect(l.domains).toHaveLength(2);
    expect(l.center).toBeDefined();
    expect(l.edges.length).toBe(2); // center → each domain
  });

  it("caps leaves per domain but keeps coordinates finite", () => {
    const l = computeReportLayout([domain("cognitive", MAX_LEAVES_PER_DOMAIN + 4)]);
    expect(l.domains[0]!.leaves.length).toBe(MAX_LEAVES_PER_DOMAIN);
    for (const leaf of l.domains[0]!.leaves) {
      expect(Number.isFinite(leaf.x)).toBe(true);
      expect(Number.isFinite(leaf.y)).toBe(true);
    }
  });

  it("maps domain ids to short map labels", () => {
    const l = computeReportLayout([domain("technical", 1)]);
    expect(l.domains[0]!.label).toBe("Operative");
  });
});
