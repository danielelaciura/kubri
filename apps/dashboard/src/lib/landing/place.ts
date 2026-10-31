import { getCacheStore } from "@/lib/cache/store";
import {
  autocompletePlaces,
  geocodeAddress,
  getPlaceDetails,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  GooglePlaceNotFoundError,
  type GooglePlace,
} from "@/lib/geo/google";
import {
  isIstatPlaceId,
  istatPlaceForText,
  nearestIstatLabel,
  resolveIstatPlace,
  searchIstatPlaces,
} from "@/lib/geo/istat-places";
import type { PlaceSuggestion, ResolvedPlace } from "@/lib/geo/place-types";

/** Shorter queries return nothing (and never reach Google). */
export const MIN_PLACE_QUERY = 3;
const MAX_QUERY = 100;
/** Same lifetime as the import cookie. */
const PREFILL_TTL_MS = 30 * 60 * 1000;

/** Logs the failure class only: queries and addresses are personal data. */
function warn(op: string, e: unknown): void {
  console.warn(`[landing] place ${op} fell back`, { name: e instanceof Error ? e.name : "unknown" });
}

export function normalizeQuery(query: string): string {
  return query.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);
}

function toResolved(p: GooglePlace): ResolvedPlace {
  const location =
    p.municipality && p.provinceCode
      ? `${p.municipality} (${p.provinceCode})`
      : nearestIstatLabel(p.latitude, p.longitude);
  return {
    placeId: p.placeId,
    source: "google",
    address: p.formattedAddress,
    location,
    latitude: p.latitude,
    longitude: p.longitude,
  };
}

async function geocodeForPrefill(text: string): Promise<PlaceSuggestion | null> {
  if (googleMapsConfigured()) {
    try {
      const p = await geocodeAddress(text);
      return p ? { placeId: p.placeId, label: p.formattedAddress } : null;
    } catch (e) {
      if (!(e instanceof GoogleMapsUnavailableError)) throw e;
      warn("prefill", e);
    }
  }
  return istatPlaceForText(text);
}

/**
 * The "Dove abiti?" prefill from the CV draft, cached per import so polling,
 * a second tab or a reload don't geocode again. Never throws: geocoding must
 * not fail the extraction.
 */
export async function prefillPlace(
  importId: string,
  draft: { address: string | null; location: string | null },
): Promise<PlaceSuggestion | null> {
  try {
    const text = draft.address?.trim() || draft.location?.trim();
    if (!text) return null;
    const cache = getCacheStore();
    const key = `landing:prefill:${importId}`;
    const hit = await cache.get<{ place: PlaceSuggestion | null }>(key);
    if (hit) return hit.place;
    const place = await geocodeForPrefill(text);
    await cache.set(key, { place }, PREFILL_TTL_MS);
    return place;
  } catch (e) {
    warn("prefill", e);
    return null;
  }
}

/** Autocomplete suggestions: Google when available, ISTAT comuni otherwise. */
export async function searchPlaces(query: string, sessionToken?: string): Promise<PlaceSuggestion[]> {
  const q = normalizeQuery(query);
  if (q.length < MIN_PLACE_QUERY) return [];
  if (googleMapsConfigured()) {
    try {
      return await autocompletePlaces(q, sessionToken);
    } catch (e) {
      if (!(e instanceof GoogleMapsUnavailableError)) throw e;
      warn("search", e);
    }
  }
  return searchIstatPlaces(q);
}

/**
 * Server-side resolution of a chosen place id. Null when the id is unknown or
 * Google cannot answer: the candidate picks again (the search then falls back
 * to ISTAT if Google is down).
 */
export async function resolvePlace(placeId: string, sessionToken?: string): Promise<ResolvedPlace | null> {
  if (isIstatPlaceId(placeId)) return resolveIstatPlace(placeId);
  if (!googleMapsConfigured()) return null;
  try {
    return toResolved(await getPlaceDetails(placeId, sessionToken));
  } catch (e) {
    if (e instanceof GooglePlaceNotFoundError) return null;
    if (e instanceof GoogleMapsUnavailableError) {
      warn("resolve", e);
      return null;
    }
    throw e;
  }
}
