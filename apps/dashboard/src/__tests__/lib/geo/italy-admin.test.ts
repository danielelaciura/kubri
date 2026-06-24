import { describe, it, expect } from "vitest";
import { ITALY_ADMIN } from "@/lib/geo/italy-admin";

describe("ITALY_ADMIN dataset", () => {
  it("contains a sensible number of municipalities", () => {
    expect(ITALY_ADMIN.length).toBeGreaterThan(7000);
  });

  it("every row has valid coordinates", () => {
    for (const row of ITALY_ADMIN) {
      expect(Number.isFinite(row.latitude)).toBe(true);
      expect(Number.isFinite(row.longitude)).toBe(true);
      expect(row.latitude).toBeGreaterThanOrEqual(35);
      expect(row.latitude).toBeLessThanOrEqual(48);
      expect(row.longitude).toBeGreaterThanOrEqual(6);
      expect(row.longitude).toBeLessThanOrEqual(19);
    }
  });

  it("has no duplicate (municipality, province) pairs", () => {
    const seen = new Set<string>();
    for (const row of ITALY_ADMIN) {
      const key = `${row.municipality}|${row.province}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it("includes well-known municipalities", () => {
    const milano = ITALY_ADMIN.find((r) => r.municipality === "Milano");
    expect(milano).toBeDefined();
    expect(milano!.region).toBe("Lombardia");
    expect(milano!.latitude).toBeCloseTo(45.46, 1);
    expect(milano!.longitude).toBeCloseTo(9.19, 1);
  });
});
