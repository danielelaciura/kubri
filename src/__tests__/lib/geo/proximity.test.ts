import { describe, it, expect } from "vitest";
import {
  haversineKm,
  filterByRadius,
  resolvePlaceCoords,
} from "@/lib/geo/proximity";

const MILANO = { latitude: 45.4642, longitude: 9.19 };
const ROMA = { latitude: 41.9028, longitude: 12.4964 };

describe("haversineKm", () => {
  it("returns 0 for identical points", () => {
    expect(haversineKm(MILANO, MILANO)).toBeCloseTo(0, 5);
  });

  it("computes Milano to Roma ≈ 477 km", () => {
    expect(haversineKm(MILANO, ROMA)).toBeGreaterThan(470);
    expect(haversineKm(MILANO, ROMA)).toBeLessThan(485);
  });

  it("is symmetric", () => {
    expect(haversineKm(MILANO, ROMA)).toBeCloseTo(haversineKm(ROMA, MILANO), 5);
  });
});

describe("filterByRadius", () => {
  const items = [
    { id: "a", latitude: 45.4642, longitude: 9.19 },
    { id: "b", latitude: 45.07, longitude: 7.69 },
    { id: "c", latitude: 41.9, longitude: 12.5 },
    { id: "d", latitude: null, longitude: null },
  ];

  it("includes only items within the radius", () => {
    const r = filterByRadius(items, MILANO, 30);
    expect(r.map((i) => i.id)).toEqual(["a"]);
  });

  it("includes Torino at 150 km", () => {
    const r = filterByRadius(items, MILANO, 150);
    expect(r.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("excludes items with null coordinates", () => {
    const r = filterByRadius(items, MILANO, 10000);
    expect(r.map((i) => i.id)).not.toContain("d");
  });
});

describe("resolvePlaceCoords", () => {
  it("resolves a known municipality", () => {
    const r = resolvePlaceCoords("Milano");
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(45.46, 1);
  });

  it("is case- and diacritics-insensitive", () => {
    expect(resolvePlaceCoords("milano")).not.toBeNull();
    expect(resolvePlaceCoords("MILANO")).not.toBeNull();
  });

  it("resolves a known province", () => {
    const r = resolvePlaceCoords("Torino");
    expect(r).not.toBeNull();
  });

  it("resolves a known region", () => {
    const r = resolvePlaceCoords("Lombardia");
    expect(r).not.toBeNull();
  });

  it("returns null for unknown places", () => {
    expect(resolvePlaceCoords("Nowhereville")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(resolvePlaceCoords("")).toBeNull();
    expect(resolvePlaceCoords("   ")).toBeNull();
  });
});
