import { haversineKm, resolvePlaceCoords, type LatLng } from "@/lib/geo/proximity";

export interface JdLocation {
  municipality?: string | null;
  province?: string | null;
  region?: string | null;
  searchRadiusKm: number;
}

export interface CandidateLocation {
  latitude: number | null;
  longitude: number | null;
}

/**
 * Continuous geographic match score between a JD and a candidate.
 *
 *   distance = 0                 → 1.0
 *   distance = searchRadiusKm    → 0.5
 *   distance = 2 × searchRadiusKm → 0.0
 *   distance > 2 × searchRadiusKm → 0.0
 *
 * Neutral fallback (0.5) when either side has no coordinates we can resolve.
 * This avoids punishing candidates for missing data and avoids breaking
 * matching when the JD's municipality is somehow unparseable.
 */
export function locationScore(params: {
  jd: JdLocation;
  candidate: CandidateLocation;
}): number {
  const { jd, candidate } = params;

  const jdCoords = resolveJdCoords(jd);
  if (!jdCoords) return 0.5;

  if (candidate.latitude == null || candidate.longitude == null) return 0.5;

  const distance = haversineKm(jdCoords, {
    latitude: candidate.latitude,
    longitude: candidate.longitude,
  });

  const radius = Math.max(1, jd.searchRadiusKm);
  return Math.max(0, 1 - distance / (2 * radius));
}

function resolveJdCoords(jd: JdLocation): LatLng | null {
  const label = jd.municipality ?? jd.province ?? jd.region;
  if (!label) return null;
  return resolvePlaceCoords(label);
}
