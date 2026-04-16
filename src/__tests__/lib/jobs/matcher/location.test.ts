import { describe, it, expect } from "vitest";
import { locationScore } from "@/lib/jobs/matcher/location";

describe("locationScore", () => {
  it("1.0 for same municipality", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Milano",
    })).toBe(1.0);
  });

  it("0.8 when candidate city is in the same province", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Sesto San Giovanni",
    })).toBeCloseTo(0.8);
  });

  it("0.6 when candidate says the region only", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Lombardia",
    })).toBeCloseTo(0.6);
  });

  it("0.6 when JD is at region level and candidate is a city inside it", () => {
    expect(locationScore({
      jd: { region: "Lombardia" },
      candidateLocation: "Milano",
    })).toBeCloseTo(0.6);
  });

  it("0 when regions differ", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Napoli",
    })).toBe(0);
  });

  it("0.5 (neutral) when candidate location is unresolved", () => {
    expect(locationScore({
      jd: { municipality: "Milano", province: "Milano", region: "Lombardia" },
      candidateLocation: "Atlantide",
    })).toBe(0.5);
  });

  it("0.5 (neutral) when JD location is unresolved at every level", () => {
    expect(locationScore({
      jd: {},
      candidateLocation: "Milano",
    })).toBe(0.5);
  });
});
