import { describe, it, expect } from "vitest";
import { geocodeFromAddress } from "@/lib/geo/proximity";

describe("geocodeFromAddress", () => {
  it("resolves the last comma-separated token as a municipality", () => {
    const r = geocodeFromAddress("Via Garibaldi 14, Milano");
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(45.46, 1);
    expect(r!.longitude).toBeCloseTo(9.19, 1);
  });

  it("handles addresses with multiple commas", () => {
    const r = geocodeFromAddress("Piazza Duomo 1, scala A, Torino");
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(45.05, 1);
  });

  it("returns null for null/empty/whitespace input", () => {
    expect(geocodeFromAddress(null)).toBeNull();
    expect(geocodeFromAddress(undefined)).toBeNull();
    expect(geocodeFromAddress("")).toBeNull();
    expect(geocodeFromAddress("   ")).toBeNull();
  });

  it("returns null when the last token is not a known place", () => {
    expect(geocodeFromAddress("Via Pippo 1, Castelpippone")).toBeNull();
  });

  it("trims whitespace around the comune token", () => {
    const r = geocodeFromAddress("Via X,    Roma   ");
    expect(r).not.toBeNull();
    expect(r!.latitude).toBeCloseTo(41.9, 1);
  });
});
