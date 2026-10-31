import type { PlaceSuggestion } from "./place-types";

/**
 * Minimal Google Maps Platform client (Geocoding API + Places API (New)).
 * Server only: the key never reaches the browser. Never log the query text
 * or the returned address: they are candidate personal data.
 */

const GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const PLACES_URL = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 3000;
/** Stored addresses are read by Italian operators. */
const LANGUAGE = "it";
const MAX_SUGGESTIONS = 5;
/** Geocoding results precise enough to stand for "where the candidate lives". */
const PRECISE_TYPES = new Set([
  "street_address", "premise", "subpremise", "route", "locality",
  "postal_code", "administrative_area_level_3", "sublocality",
]);
/** Google place ids are URL-safe base64-like strings. */
const PLACE_ID_RE = /^[A-Za-z0-9_-]{1,300}$/;

export class GoogleMapsUnavailableError extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`google maps unavailable: ${reason}`, { cause });
    this.name = "GoogleMapsUnavailableError";
  }
}

export class GooglePlaceNotFoundError extends Error {
  constructor() {
    super("google place not found");
    this.name = "GooglePlaceNotFoundError";
  }
}

export interface GooglePlace {
  placeId: string;
  formattedAddress: string;
  latitude: number;
  longitude: number;
  municipality: string | null;
  /** Two-letter province code ("MI"), or null when Google gives something else. */
  provinceCode: string | null;
}

interface Component {
  long: string;
  short: string;
  types: string[];
}

export function googleMapsConfigured(): boolean {
  return Boolean(process.env.GOOGLE_MAPS_API_KEY?.trim());
}

function apiKey(): string {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) throw new GoogleMapsUnavailableError("missing key");
  return key;
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  try {
    return await fetch(url, { ...init, cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new GoogleMapsUnavailableError("network", e);
  }
}

function adminFrom(components: Component[]): Pick<GooglePlace, "municipality" | "provinceCode"> {
  const find = (type: string) => components.find((c) => c.types.includes(type));
  const comune = find("locality") ?? find("administrative_area_level_3");
  const province = find("administrative_area_level_2")?.short ?? "";
  return {
    municipality: comune?.long ?? null,
    provinceCode: /^[A-Z]{2}$/.test(province) ? province : null,
  };
}

interface GeocodeResult {
  place_id: string;
  formatted_address: string;
  types: string[];
  geometry: { location: { lat: number; lng: number } };
  address_components: { long_name: string; short_name: string; types: string[] }[];
}

/** Best precise match in Italy, or null (no result / too generic). */
export async function geocodeAddress(text: string): Promise<GooglePlace | null> {
  const params = new URLSearchParams({
    address: text, components: "country:IT", region: "it", language: LANGUAGE, key: apiKey(),
  });
  const res = await call(`${GEOCODE_URL}?${params.toString()}`);
  if (!res.ok) throw new GoogleMapsUnavailableError(`geocode HTTP ${res.status}`);
  const body = (await res.json()) as { status?: string; results?: GeocodeResult[] };
  if (body.status === "ZERO_RESULTS") return null;
  if (body.status !== "OK") throw new GoogleMapsUnavailableError(`geocode status ${body.status ?? "?"}`);
  const hit = body.results?.find((r) => r.types.some((t) => PRECISE_TYPES.has(t)));
  if (!hit) return null;
  return {
    placeId: hit.place_id,
    formattedAddress: hit.formatted_address,
    latitude: hit.geometry.location.lat,
    longitude: hit.geometry.location.lng,
    ...adminFrom(hit.address_components.map((c) => ({ long: c.long_name, short: c.short_name, types: c.types }))),
  };
}

/** Places Autocomplete (New), restricted to Italy. */
export async function autocompletePlaces(input: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const res = await call(`${PLACES_URL}/places:autocomplete`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text",
    },
    body: JSON.stringify({
      input,
      includedRegionCodes: ["it"],
      regionCode: "it",
      languageCode: LANGUAGE,
      ...(sessionToken ? { sessionToken } : {}),
    }),
  });
  if (!res.ok) throw new GoogleMapsUnavailableError(`autocomplete HTTP ${res.status}`);
  const body = (await res.json()) as {
    suggestions?: { placePrediction?: { placeId?: string; text?: { text?: string } } }[];
  };
  return (body.suggestions ?? [])
    .flatMap((s) => {
      const p = s.placePrediction;
      return p?.placeId && p.text?.text ? [{ placeId: p.placeId, label: p.text.text }] : [];
    })
    .slice(0, MAX_SUGGESTIONS);
}

/** Place Details (New). Closes the autocomplete session when a token is given. */
export async function getPlaceDetails(placeId: string, sessionToken?: string): Promise<GooglePlace> {
  if (!PLACE_ID_RE.test(placeId)) throw new GooglePlaceNotFoundError();
  const params = new URLSearchParams({ languageCode: LANGUAGE });
  if (sessionToken) params.set("sessionToken", sessionToken);
  const res = await call(`${PLACES_URL}/places/${placeId}?${params.toString()}`, {
    headers: {
      "X-Goog-Api-Key": apiKey(),
      "X-Goog-FieldMask": "id,formattedAddress,location,addressComponents",
    },
  });
  if (res.status === 400 || res.status === 404) throw new GooglePlaceNotFoundError();
  if (!res.ok) throw new GoogleMapsUnavailableError(`details HTTP ${res.status}`);
  const body = (await res.json()) as {
    id?: string;
    formattedAddress?: string;
    location?: { latitude?: number; longitude?: number };
    addressComponents?: { longText: string; shortText: string; types: string[] }[];
  };
  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  if (!body.id || !body.formattedAddress || typeof lat !== "number" || typeof lng !== "number") {
    throw new GooglePlaceNotFoundError();
  }
  return {
    placeId: body.id,
    formattedAddress: body.formattedAddress,
    latitude: lat,
    longitude: lng,
    ...adminFrom((body.addressComponents ?? []).map((c) => ({ long: c.longText, short: c.shortText, types: c.types }))),
  };
}
