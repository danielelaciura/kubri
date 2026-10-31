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

/** Parse a JSON body; a timeout while reading or a non-JSON body means Google is unavailable. */
async function readJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (e) {
    throw new GoogleMapsUnavailableError("body", e);
  }
}

function adminFrom(components: Component[]): Pick<GooglePlace, "municipality" | "provinceCode"> {
  const find = (type: string) => components.find((c) => c.types.includes(type));
  // In Italy level_3 is the comune; "locality" is often a frazione (Lido di Camaiore).
  const comune = find("administrative_area_level_3") ?? find("locality");
  const province = find("administrative_area_level_2")?.short ?? "";
  return {
    municipality: comune?.long ?? null,
    provinceCode: /^[A-Z]{2}$/.test(province) ? province : null,
  };
}

/** Raw address components → our shape; anything malformed is dropped, never thrown. */
function componentsFrom(raw: unknown, longKey: string, shortKey: string): Component[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c: unknown) => {
    if (!c || typeof c !== "object") return [];
    const o = c as Record<string, unknown>;
    const types = Array.isArray(o.types) ? o.types.filter((t): t is string => typeof t === "string") : [];
    const long = typeof o[longKey] === "string" ? (o[longKey] as string) : "";
    const short = typeof o[shortKey] === "string" ? (o[shortKey] as string) : "";
    return [{ long, short, types }];
  });
}

/** Partial on purpose: Google bodies are untrusted, every field is checked before use. */
interface GeocodeResult {
  place_id?: unknown;
  formatted_address?: unknown;
  types?: unknown;
  geometry?: { location?: { lat?: unknown; lng?: unknown } } | null;
  address_components?: unknown;
}

function geocodePlace(r: GeocodeResult | null | undefined): GooglePlace | null {
  if (!r || typeof r !== "object") return null;
  const types = Array.isArray(r.types) ? r.types : [];
  if (!types.some((t) => typeof t === "string" && PRECISE_TYPES.has(t))) return null;
  const lat = r.geometry?.location?.lat;
  const lng = r.geometry?.location?.lng;
  if (
    typeof r.place_id !== "string" || typeof r.formatted_address !== "string" ||
    typeof lat !== "number" || typeof lng !== "number"
  ) {
    return null;
  }
  return {
    placeId: r.place_id,
    formattedAddress: r.formatted_address,
    latitude: lat,
    longitude: lng,
    ...adminFrom(componentsFrom(r.address_components, "long_name", "short_name")),
  };
}

/** Best precise match in Italy, or null (no result / too generic). */
export async function geocodeAddress(text: string): Promise<GooglePlace | null> {
  const params = new URLSearchParams({
    address: text, components: "country:IT", region: "it", language: LANGUAGE, key: apiKey(),
  });
  const res = await call(`${GEOCODE_URL}?${params.toString()}`);
  if (!res.ok) throw new GoogleMapsUnavailableError(`geocode HTTP ${res.status}`);
  const body = await readJson<{ status?: unknown; results?: unknown } | null>(res);
  const status = typeof body?.status === "string" ? body.status : "?";
  if (status === "ZERO_RESULTS") return null;
  if (status !== "OK") throw new GoogleMapsUnavailableError(`geocode status ${status}`);
  if (!Array.isArray(body?.results)) throw new GoogleMapsUnavailableError("geocode body shape");
  // Malformed results are skipped; the first usable precise result wins.
  for (const r of body.results as (GeocodeResult | null)[]) {
    const place = geocodePlace(r);
    if (place) return place;
  }
  return null;
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
  const body = await readJson<{ suggestions?: unknown } | null>(res);
  const suggestions = Array.isArray(body?.suggestions) ? body.suggestions : [];
  return (suggestions as ({ placePrediction?: { placeId?: unknown; text?: { text?: unknown } | null } | null } | null)[])
    .flatMap((s) => {
      const p = s?.placePrediction;
      const placeId = p?.placeId;
      const label = p?.text?.text;
      return typeof placeId === "string" && placeId && typeof label === "string" && label
        ? [{ placeId, label }]
        : [];
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
  // Google answers 400 INVALID_ARGUMENT for unknown or malformed place ids. The field
  // mask is a constant covered by tests, so a 400 here means the id, not our request.
  if (res.status === 400 || res.status === 404) throw new GooglePlaceNotFoundError();
  if (!res.ok) throw new GoogleMapsUnavailableError(`details HTTP ${res.status}`);
  const body = await readJson<{
    id?: unknown;
    formattedAddress?: unknown;
    location?: { latitude?: unknown; longitude?: unknown } | null;
    addressComponents?: unknown;
  } | null>(res);
  const id = body?.id;
  const formattedAddress = body?.formattedAddress;
  const lat = body?.location?.latitude;
  const lng = body?.location?.longitude;
  if (
    typeof id !== "string" || !id || typeof formattedAddress !== "string" || !formattedAddress ||
    typeof lat !== "number" || typeof lng !== "number"
  ) {
    throw new GooglePlaceNotFoundError();
  }
  return {
    placeId: id,
    formattedAddress,
    latitude: lat,
    longitude: lng,
    ...adminFrom(componentsFrom(body?.addressComponents, "longText", "shortText")),
  };
}
