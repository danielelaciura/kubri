import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  autocompletePlaces,
  geocodeAddress,
  getPlaceDetails,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  GooglePlaceNotFoundError,
} from "@/lib/geo/google";

const fetchMock = vi.fn();
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const GEOCODE_HIT = {
  status: "OK",
  results: [
    {
      place_id: "ChIJgeo",
      formatted_address: "Via Roma, 12, 20121 Milano MI, Italia",
      types: ["street_address"],
      geometry: { location: { lat: 45.47, lng: 9.19 } },
      address_components: [
        { long_name: "Milano", short_name: "Milano", types: ["locality", "political"] },
        { long_name: "Città Metropolitana di Milano", short_name: "MI", types: ["administrative_area_level_2"] },
      ],
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  fetchMock.mockReset();
});

describe("googleMapsConfigured", () => {
  it("reflects the env key", () => {
    expect(googleMapsConfigured()).toBe(true);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", " ");
    expect(googleMapsConfigured()).toBe(false);
  });
});

describe("geocodeAddress", () => {
  it("returns a precise result restricted to Italy, in Italian", async () => {
    fetchMock.mockResolvedValueOnce(json(GEOCODE_HIT));
    await expect(geocodeAddress("Via Roma 12 Milano")).resolves.toEqual({
      placeId: "ChIJgeo",
      formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
      latitude: 45.47,
      longitude: 9.19,
      municipality: "Milano",
      provinceCode: "MI",
    });
    const url = new URL(fetchMock.mock.calls[0]![0] as string);
    expect(url.searchParams.get("components")).toBe("country:IT");
    expect(url.searchParams.get("language")).toBe("it");
    expect(url.searchParams.get("key")).toBe("k");
  });

  it("returns null for ZERO_RESULTS or a too generic result", async () => {
    fetchMock.mockResolvedValueOnce(json({ status: "ZERO_RESULTS", results: [] }));
    await expect(geocodeAddress("xx")).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(json({
      status: "OK",
      results: [{ ...GEOCODE_HIT.results[0], types: ["country", "political"] }],
    }));
    await expect(geocodeAddress("Italia")).resolves.toBeNull();
  });

  it("throws GoogleMapsUnavailableError on missing key, HTTP or API errors and network failures", async () => {
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "");
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    vi.stubEnv("GOOGLE_MAPS_API_KEY", "k");
    fetchMock.mockResolvedValueOnce(json({}, 500));
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    fetchMock.mockResolvedValueOnce(json({ status: "REQUEST_DENIED" }));
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    fetchMock.mockRejectedValueOnce(new DOMException("timeout", "TimeoutError"));
    await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
  });
});

describe("unreadable bodies", () => {
  const badJson = () => new Response("<html>oops</html>", { status: 200 });
  const rejectingJson = () => {
    const res = new Response("{}", { status: 200 });
    vi.spyOn(res, "json").mockRejectedValue(new DOMException("timeout", "TimeoutError"));
    return res;
  };

  it("maps a non-JSON or aborted body to GoogleMapsUnavailableError", async () => {
    for (const make of [badJson, rejectingJson]) {
      fetchMock.mockResolvedValueOnce(make());
      await expect(geocodeAddress("x")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
      fetchMock.mockResolvedValueOnce(make());
      await expect(autocompletePlaces("via roma")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
      fetchMock.mockResolvedValueOnce(make());
      await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    }
  });
});

describe("autocompletePlaces", () => {
  it("posts the query with Italy restriction and session token, maps up to 5 suggestions", async () => {
    fetchMock.mockResolvedValueOnce(json({
      suggestions: [
        { placePrediction: { placeId: "p1", text: { text: "Via Roma, Milano, MI, Italia" } } },
        { queryPrediction: { text: { text: "ignored" } } },
        { placePrediction: { placeId: "p2", text: { text: "Roma, RM, Italia" } } },
      ],
    }));
    await expect(autocompletePlaces("via roma", "tok")).resolves.toEqual([
      { placeId: "p1", label: "Via Roma, Milano, MI, Italia" },
      { placeId: "p2", label: "Roma, RM, Italia" },
    ]);
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe("https://places.googleapis.com/v1/places:autocomplete");
    expect(JSON.parse(init.body as string)).toEqual({
      input: "via roma", includedRegionCodes: ["it"], regionCode: "it", languageCode: "it", sessionToken: "tok",
    });
    expect((init.headers as Record<string, string>)["X-Goog-Api-Key"]).toBe("k");
  });

  it("throws GoogleMapsUnavailableError on HTTP errors", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 403));
    await expect(autocompletePlaces("via roma")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
  });
});

describe("getPlaceDetails", () => {
  const DETAILS = {
    id: "p1",
    formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
    location: { latitude: 45.47, longitude: 9.19 },
    addressComponents: [
      { longText: "Milano", shortText: "Milano", types: ["locality", "political"] },
      { longText: "Città Metropolitana di Milano", shortText: "MI", types: ["administrative_area_level_2"] },
    ],
  };

  it("fetches the fields we need with the session token", async () => {
    fetchMock.mockResolvedValueOnce(json(DETAILS));
    await expect(getPlaceDetails("p1", "tok")).resolves.toEqual({
      placeId: "p1",
      formattedAddress: "Via Roma, 12, 20121 Milano MI, Italia",
      latitude: 45.47,
      longitude: 9.19,
      municipality: "Milano",
      provinceCode: "MI",
    });
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    const u = new URL(url);
    expect(u.pathname).toBe("/v1/places/p1");
    expect(u.searchParams.get("sessionToken")).toBe("tok");
    expect(u.searchParams.get("languageCode")).toBe("it");
    expect((init.headers as Record<string, string>)["X-Goog-FieldMask"]).toBe(
      "id,formattedAddress,location,addressComponents",
    );
  });

  it("falls back to administrative_area_level_3 and drops a non-2-letter province", async () => {
    fetchMock.mockResolvedValueOnce(json({
      ...DETAILS,
      addressComponents: [
        { longText: "Sesto San Giovanni", shortText: "Sesto S.G.", types: ["administrative_area_level_3"] },
        { longText: "Milano", shortText: "Metropolitan City of Milan", types: ["administrative_area_level_2"] },
      ],
    }));
    await expect(getPlaceDetails("p1")).resolves.toMatchObject({
      municipality: "Sesto San Giovanni", provinceCode: null,
    });
  });

  it("rejects malformed ids without calling Google, and maps 400/404 to not found", async () => {
    await expect(getPlaceDetails("../x")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({}, 404));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
    fetchMock.mockResolvedValueOnce(json({}, 400));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
  });

  it("prefers the level_3 comune over a frazione locality", async () => {
    fetchMock.mockResolvedValueOnce(json({
      ...DETAILS,
      addressComponents: [
        { longText: "Lido di Camaiore", shortText: "Lido di Camaiore", types: ["locality", "political"] },
        { longText: "Camaiore", shortText: "Camaiore", types: ["administrative_area_level_3", "political"] },
        { longText: "Provincia di Lucca", shortText: "LU", types: ["administrative_area_level_2"] },
      ],
    }));
    await expect(getPlaceDetails("p1")).resolves.toMatchObject({
      municipality: "Camaiore", provinceCode: "LU",
    });
  });

  it("throws unavailable on 5xx and not found on an incomplete body", async () => {
    fetchMock.mockResolvedValueOnce(json({}, 503));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GoogleMapsUnavailableError);
    fetchMock.mockResolvedValueOnce(json({ id: "p1" }));
    await expect(getPlaceDetails("p1")).rejects.toBeInstanceOf(GooglePlaceNotFoundError);
  });
});
