import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/geo/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geo/google")>("@/lib/geo/google");
  return { ...actual, googleMapsConfigured: vi.fn(), geocodeAddress: vi.fn() };
});

import { geocodeAddress, googleMapsConfigured, GoogleMapsUnavailableError } from "@/lib/geo/google";
import { geocodeFreeText, googlePlaceToResolved } from "@/lib/geo/geocode-text";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const GOOGLE_PLACE = {
  placeId: "ChIJ1", formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
  latitude: 45.47, longitude: 9.19, municipality: "Milano", provinceCode: "MI",
};

beforeEach(() => {
  vi.clearAllMocks();
  m(googleMapsConfigured).mockReturnValue(true);
});

describe("googlePlaceToResolved", () => {
  it("uses the comune and province from Google", () => {
    expect(googlePlaceToResolved(GOOGLE_PLACE)).toEqual({
      placeId: "ChIJ1", source: "google", address: "Via Roma, 12, 20121 Milano MI, Italia",
      location: "Milano (MI)", latitude: 45.47, longitude: 9.19,
    });
  });

  it("falls back to the nearest ISTAT comune when components are incomplete", () => {
    expect(googlePlaceToResolved({ ...GOOGLE_PLACE, provinceCode: null }).location).toBe("Milano (MI)");
  });
});

describe("geocodeFreeText", () => {
  it("geocodes with Google", async () => {
    m(geocodeAddress).mockResolvedValue(GOOGLE_PLACE);
    await expect(geocodeFreeText("Via Roma 12, Milano")).resolves.toMatchObject({
      source: "google", location: "Milano (MI)", latitude: 45.47, longitude: 9.19,
    });
    expect(m(geocodeAddress)).toHaveBeenCalledWith("Via Roma 12, Milano");
  });

  it("returns null when Google finds nothing precise", async () => {
    m(geocodeAddress).mockResolvedValue(null);
    await expect(geocodeFreeText("Nowhere")).resolves.toBeNull();
  });

  it("falls back to the ISTAT comune, with coordinates, when Google is down", async () => {
    m(geocodeAddress).mockRejectedValue(new GoogleMapsUnavailableError("down"));
    const place = await geocodeFreeText("Via X 1, Torino");
    expect(place).toMatchObject({ placeId: "istat:TO:torino", source: "istat", location: "Torino (TO)" });
    expect(place?.latitude).toEqual(expect.any(Number));
    expect(place?.longitude).toEqual(expect.any(Number));
  });

  it("uses ISTAT without calling Google when Google is not configured", async () => {
    m(googleMapsConfigured).mockReturnValue(false);
    await expect(geocodeFreeText("Milano (MI)")).resolves.toMatchObject({ source: "istat", location: "Milano (MI)" });
    expect(m(geocodeAddress)).not.toHaveBeenCalled();
  });

  it("returns null for blank text or an unknown comune", async () => {
    await expect(geocodeFreeText("   ")).resolves.toBeNull();
    expect(m(geocodeAddress)).not.toHaveBeenCalled();
    m(googleMapsConfigured).mockReturnValue(false);
    await expect(geocodeFreeText("Atlantide")).resolves.toBeNull();
  });

  it("never throws, and logs only the error class", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m(geocodeAddress).mockRejectedValue(new Error("boom Via Segreta 1"));
    await expect(geocodeFreeText("Via Segreta 1, Milano")).resolves.toBeNull();
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain("Segreta");
    expect(logged).toContain("Error");
    warn.mockRestore();
  });
});
