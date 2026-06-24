import { describe, it, expect } from "vitest";
import { locationScore } from "@/lib/jobs/matcher/location";
import { resolvePlaceCoords } from "@/lib/geo/proximity";

const MILANO = resolvePlaceCoords("Milano")!;
const SESTO = resolvePlaceCoords("Sesto San Giovanni")!;
const NAPOLI = resolvePlaceCoords("Napoli")!;

describe("locationScore (Haversine)", () => {
  it("returns 1.0 when candidate sits exactly at the JD municipality", () => {
    expect(
      locationScore({
        jd: { municipality: "Milano", searchRadiusKm: 25 },
        candidate: MILANO,
      }),
    ).toBe(1.0);
  });

  it("decays as candidate moves away (small radius makes nearby candidates score lower)", () => {
    // Sesto San Giovanni is ~9 km from Milano per ISTAT coords. With a
    // generous radius of 25 km, it scores comfortably inside.
    const generous = locationScore({
      jd: { municipality: "Milano", searchRadiusKm: 25 },
      candidate: SESTO,
    });
    // With a tight radius of 5 km, the same candidate is far past 2× radius
    // and the score drops sharply.
    const strict = locationScore({
      jd: { municipality: "Milano", searchRadiusKm: 5 },
      candidate: SESTO,
    });
    expect(generous).toBeGreaterThan(strict);
    expect(generous).toBeGreaterThan(0.75);
    expect(strict).toBeLessThan(0.2);
  });

  it("returns 0 when candidate is farther than 2× the search radius", () => {
    // Milano ↔ Napoli ≈ 660 km. Radius 25 → cutoff at 50.
    expect(
      locationScore({
        jd: { municipality: "Milano", searchRadiusKm: 25 },
        candidate: NAPOLI,
      }),
    ).toBe(0);
  });

  it("returns 0.5 (neutral) when candidate has no coordinates", () => {
    expect(
      locationScore({
        jd: { municipality: "Milano", searchRadiusKm: 25 },
        candidate: { latitude: null, longitude: null },
      }),
    ).toBe(0.5);
  });

  it("returns 0.5 (neutral) when JD has no resolvable location", () => {
    expect(
      locationScore({
        jd: {
          municipality: "Castelpippone",
          province: null,
          region: null,
          searchRadiusKm: 25,
        },
        candidate: MILANO,
      }),
    ).toBe(0.5);
  });

  it("falls back to province coords when municipality is missing", () => {
    expect(
      locationScore({
        jd: { municipality: null, province: "Milano", searchRadiusKm: 50 },
        candidate: MILANO,
      }),
    ).toBeGreaterThan(0.9);
  });

  it("falls back to region coords when both municipality and province are missing", () => {
    expect(
      locationScore({
        jd: { municipality: null, province: null, region: "Lombardia", searchRadiusKm: 100 },
        candidate: MILANO,
      }),
    ).toBeGreaterThan(0.5);
  });

  it("decays linearly: half radius → ~0.75", () => {
    // Build a candidate exactly at half the search radius (12.5 km from Milano)
    // by going due east in degrees. ~1° lon ≈ 78 km at Milano's latitude.
    const halfRadiusKm = 12.5;
    const candidate = {
      latitude: MILANO.latitude,
      longitude: MILANO.longitude + halfRadiusKm / 78,
    };
    const score = locationScore({
      jd: { municipality: "Milano", searchRadiusKm: 25 },
      candidate,
    });
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(0.8);
  });
});
