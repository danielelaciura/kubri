import {
  geocodeAddress,
  googleMapsConfigured,
  GoogleMapsUnavailableError,
  type GooglePlace,
} from "@/lib/geo/google";
import { istatPlaceForText, nearestIstatLabel, resolveIstatPlace } from "@/lib/geo/istat-places";
import type { ResolvedPlace } from "@/lib/geo/place-types";

/** Logs the failure class only: the text and the address are personal data. */
function warn(op: string, e: unknown): void {
  console.warn(`[geo] ${op} fell back`, { name: e instanceof Error ? e.name : "unknown" });
}

/** A Google place → our shape; "Comune (PROV)" from the nearest comune when Google lacks it. */
export function googlePlaceToResolved(p: GooglePlace): ResolvedPlace {
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

function istatForText(text: string): ResolvedPlace | null {
  const suggestion = istatPlaceForText(text);
  return suggestion ? resolveIstatPlace(suggestion.placeId) : null;
}

/**
 * Free text ("Via Roma 12, Milano") → a place with coordinates. Google Geocoding when
 * configured (precise, to the address); the ISTAT comune in the text's last token when Google
 * is not configured or unavailable. Null when nothing matches. Never throws.
 */
export async function geocodeFreeText(text: string): Promise<ResolvedPlace | null> {
  try {
    const q = text.trim();
    if (!q) return null;
    if (googleMapsConfigured()) {
      try {
        const p = await geocodeAddress(q);
        return p ? googlePlaceToResolved(p) : null;
      } catch (e) {
        if (!(e instanceof GoogleMapsUnavailableError)) throw e;
        warn("geocode", e);
      }
    }
    return istatForText(q);
  } catch (e) {
    warn("geocode", e);
    return null;
  }
}
