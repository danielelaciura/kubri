import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/geo/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geo/google")>("@/lib/geo/google");
  return {
    ...actual,
    googleMapsConfigured: vi.fn(),
    geocodeAddress: vi.fn(),
    autocompletePlaces: vi.fn(),
    getPlaceDetails: vi.fn(),
  };
});

import {
  autocompletePlaces,
  geocodeAddress,
  getPlaceDetails,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  GooglePlaceNotFoundError,
} from "@/lib/geo/google";
import { _resetCacheStoreForTests } from "@/lib/cache/store";
import { normalizeQuery, prefillPlace, resolvePlace, searchPlaces } from "@/lib/landing/place";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const GOOGLE_PLACE = {
  placeId: "ChIJ1", formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
  latitude: 45.47, longitude: 9.19, municipality: "Milano", provinceCode: "MI",
};

beforeEach(() => {
  vi.clearAllMocks();
  _resetCacheStoreForTests();
  m(googleMapsConfigured).mockReturnValue(true);
});

describe("normalizeQuery", () => {
  it("collapses whitespace and caps the length", () => {
    expect(normalizeQuery("  via   roma ")).toBe("via roma");
    expect(normalizeQuery("x".repeat(150))).toHaveLength(100);
  });
});

describe("prefillPlace", () => {
  it("geocodes the draft address once per import (cached)", async () => {
    m(geocodeAddress).mockResolvedValue(GOOGLE_PLACE);
    const draft = { address: "Via Roma 12, Milano", location: "Milano (MI)" };
    const expected = { placeId: "ChIJ1", label: "Via Roma, 12, 20121 Milano MI, Italia" };
    await expect(prefillPlace("imp-1", draft)).resolves.toEqual(expected);
    await expect(prefillPlace("imp-1", draft)).resolves.toEqual(expected);
    expect(m(geocodeAddress)).toHaveBeenCalledTimes(1);
    expect(m(geocodeAddress)).toHaveBeenCalledWith("Via Roma 12, Milano");
  });

  it("uses the location when there is no address, and null when there is neither", async () => {
    m(geocodeAddress).mockResolvedValue(null);
    await expect(prefillPlace("imp-2", { address: null, location: "Milano (MI)" })).resolves.toBeNull();
    expect(m(geocodeAddress)).toHaveBeenCalledWith("Milano (MI)");
    await expect(prefillPlace("imp-3", { address: " ", location: null })).resolves.toBeNull();
    expect(m(geocodeAddress)).toHaveBeenCalledTimes(1);
  });

  it("falls back to the ISTAT comune when Google is unavailable or not configured", async () => {
    m(geocodeAddress).mockRejectedValue(new GoogleMapsUnavailableError("down"));
    await expect(prefillPlace("imp-4", { address: "Via X 1, Torino", location: null }))
      .resolves.toEqual({ placeId: "istat:TO:torino", label: "Torino (TO)" });
    m(googleMapsConfigured).mockReturnValue(false);
    await expect(prefillPlace("imp-5", { address: null, location: "Milano (MI)" }))
      .resolves.toEqual({ placeId: "istat:MI:milano", label: "Milano (MI)" });
  });

  it("never throws", async () => {
    m(geocodeAddress).mockRejectedValue(new Error("boom"));
    await expect(prefillPlace("imp-6", { address: "Via X", location: null })).resolves.toBeNull();
  });
});

describe("searchPlaces", () => {
  it("returns nothing under 3 chars without calling Google", async () => {
    await expect(searchPlaces("ro")).resolves.toEqual([]);
    expect(m(autocompletePlaces)).not.toHaveBeenCalled();
  });

  it("uses Google autocomplete with the session token", async () => {
    m(autocompletePlaces).mockResolvedValue([{ placeId: "p1", label: "Roma, RM, Italia" }]);
    await expect(searchPlaces("roma", "tok")).resolves.toEqual([{ placeId: "p1", label: "Roma, RM, Italia" }]);
    expect(m(autocompletePlaces)).toHaveBeenCalledWith("roma", "tok");
  });

  it("falls back to ISTAT comuni when Google is unavailable or not configured", async () => {
    m(autocompletePlaces).mockRejectedValue(new GoogleMapsUnavailableError("down"));
    expect((await searchPlaces("milano"))[0]).toEqual({ placeId: "istat:MI:milano", label: "Milano (MI)" });
    m(googleMapsConfigured).mockReturnValue(false);
    expect((await searchPlaces("torino"))[0]).toEqual({ placeId: "istat:TO:torino", label: "Torino (TO)" });
  });
});

describe("resolvePlace", () => {
  it("resolves a Google id through Place Details", async () => {
    m(getPlaceDetails).mockResolvedValue(GOOGLE_PLACE);
    await expect(resolvePlace("ChIJ1", "tok")).resolves.toEqual({
      placeId: "ChIJ1", source: "google", address: "Via Roma, 12, 20121 Milano MI, Italia",
      location: "Milano (MI)", latitude: 45.47, longitude: 9.19,
    });
    expect(m(getPlaceDetails)).toHaveBeenCalledWith("ChIJ1", "tok");
  });

  it("builds the location from the nearest comune when components are incomplete", async () => {
    m(getPlaceDetails).mockResolvedValue({ ...GOOGLE_PLACE, provinceCode: null });
    await expect(resolvePlace("ChIJ1")).resolves.toMatchObject({ location: "Milano (MI)" });
  });

  it("resolves an ISTAT id without Google", async () => {
    await expect(resolvePlace("istat:MI:milano")).resolves.toMatchObject({ source: "istat", location: "Milano (MI)" });
    expect(m(getPlaceDetails)).not.toHaveBeenCalled();
  });

  it("returns null for unknown ids, Google errors, or Google ids without a key", async () => {
    m(getPlaceDetails).mockRejectedValueOnce(new GooglePlaceNotFoundError());
    await expect(resolvePlace("ChIJbad")).resolves.toBeNull();
    m(getPlaceDetails).mockRejectedValueOnce(new GoogleMapsUnavailableError("down"));
    await expect(resolvePlace("ChIJ1")).resolves.toBeNull();
    await expect(resolvePlace("istat:XX:nowhere")).resolves.toBeNull();
    m(googleMapsConfigured).mockReturnValue(false);
    await expect(resolvePlace("ChIJ1")).resolves.toBeNull();
  });
});
