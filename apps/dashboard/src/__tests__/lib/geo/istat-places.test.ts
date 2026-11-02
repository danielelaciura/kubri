import { describe, it, expect } from "vitest";
import {
  isIstatPlaceId,
  istatPlaceForText,
  nearestIstatLabel,
  resolveIstatPlace,
  searchIstatPlaces,
} from "@/lib/geo/istat-places";

describe("searchIstatPlaces", () => {
  it("puts the exact match first, then prefixes, shortest first", () => {
    const r = searchIstatPlaces("milano");
    expect(r[0]).toEqual({ placeId: "istat:MI:milano", label: "Milano (MI)" });
    expect(r.length).toBeLessThanOrEqual(5);
    expect(r.every((s) => isIstatPlaceId(s.placeId))).toBe(true);
  });

  it("ignores case and accents", () => {
    expect(searchIstatPlaces("CANTU")[0]?.label).toBe("Cantù (CO)");
  });

  it("returns nothing for queries under 2 chars or no match", () => {
    expect(searchIstatPlaces("m")).toEqual([]);
    expect(searchIstatPlaces("zzzzqq")).toEqual([]);
  });
});

describe("resolveIstatPlace", () => {
  it("round-trips a search id to the comune centroid", () => {
    const r = resolveIstatPlace("istat:MI:milano");
    expect(r).toMatchObject({
      placeId: "istat:MI:milano", source: "istat", address: "Milano (MI)", location: "Milano (MI)",
    });
    expect(r!.latitude).toBeCloseTo(45.46, 0);
    expect(r!.longitude).toBeCloseTo(9.19, 0);
  });

  it("returns null for an unknown id", () => {
    expect(resolveIstatPlace("istat:XX:nowhere")).toBeNull();
    expect(resolveIstatPlace("ChIJ123")).toBeNull();
  });
});

describe("istatPlaceForText", () => {
  it("matches the comune in the last comma-separated token", () => {
    expect(istatPlaceForText("Via Garibaldi 14, 20121 Milano (MI)")).toEqual({
      placeId: "istat:MI:milano", label: "Milano (MI)",
    });
    expect(istatPlaceForText("Torino")).toEqual({ placeId: "istat:TO:torino", label: "Torino (TO)" });
  });

  it("uses the province code to pick between homonymous comuni", () => {
    expect(istatPlaceForText("Via X 1, Calliano (TN)")).toEqual({
      placeId: "istat:TN:calliano", label: "Calliano (TN)",
    });
    expect(istatPlaceForText("Calliano (AT)")).toEqual({
      placeId: "istat:AT:calliano", label: "Calliano (AT)",
    });
    expect(istatPlaceForText("Calliano (at)")?.placeId).toBe("istat:AT:calliano");
  });

  it("returns null when no comune matches", () => {
    expect(istatPlaceForText("Casablanca, Marocco")).toBeNull();
    expect(istatPlaceForText("  ")).toBeNull();
  });
});

describe("nearestIstatLabel", () => {
  it("returns the closest comune label", () => {
    expect(nearestIstatLabel(45.4642, 9.19)).toBe("Milano (MI)");
  });
});
