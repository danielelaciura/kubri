import { prisma } from "@/lib/db";
import type { Candidate } from "@/types";
import { MATCHER_CONFIG } from "./config";
import { locationScore } from "./location";
import { MatchingUnavailableError } from "@/lib/embeddings/errors";
import { haversineKm, resolvePlaceCoords, type LatLng } from "@/lib/geo/proximity";

export interface JdForMatching {
  embedding: number[] | null;
  locationMunicipality: string | null;
  locationProvince: string | null;
  locationRegion: string | null;
  searchRadiusKm: number;
}

export interface MatchResult {
  final: number;
  breakdown: { semantic: number; location: number };
}

export interface RankedCandidate {
  candidate: Candidate;
  match: MatchResult;
  isFallback: boolean;
}

export function computeMatchFromScores(scores: { semantic: number; location: number }): MatchResult {
  const w = MATCHER_CONFIG.weights;
  const rescaled = rescaleSemantic(scores.semantic);
  const final = Math.round(100 * (w.semantic * rescaled + w.location * scores.location));
  return { final, breakdown: { semantic: rescaled, location: scores.location } };
}

function rescaleSemantic(raw: number): number {
  const cfg = MATCHER_CONFIG.semanticRescale;
  if (!cfg.enabled) return raw;
  const span = 1 - cfg.floor;
  if (span <= 0) return raw;
  return Math.max(0, Math.min(1, (raw - cfg.floor) / span));
}

export async function rankCandidates(
  jd: JdForMatching,
  candidates: Candidate[],
): Promise<RankedCandidate[]> {
  if (!jd.embedding) {
    throw new MatchingUnavailableError("JD has no embedding yet");
  }
  if (candidates.length === 0) return [];

  // 1. Hard pre-filter by Haversine radius (when both sides have coordinates).
  const eligible = applyLocationFilter(jd, candidates);
  if (eligible.length === 0) return [];

  // 2. Semantic ranking over the survivors.
  const vectorLiteral = `[${jd.embedding.join(",")}]`;
  const dbIds = eligible.map((c) => c.dbId).filter((id) => id.length > 0);
  if (dbIds.length === 0) return [];

  type Row = { id: string; semantic: number };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id::text AS id,
           1 - (embedding <=> ${vectorLiteral}::vector) AS semantic
    FROM "Candidate"
    WHERE id = ANY(${dbIds}::uuid[])
      AND embedding IS NOT NULL
  `;
  const semanticByDbId = new Map<string, number>(rows.map((r) => [r.id, Number(r.semantic)]));

  const scored = eligible.map((c) => {
    const semantic = semanticByDbId.get(c.dbId) ?? 0;
    // Location is now a binary pre-filter, not a score component. We still
    // call locationScore for the breakdown to keep MatchResult.shape stable.
    const location = locationScore({
      jd: {
        municipality: jd.locationMunicipality,
        province: jd.locationProvince,
        region: jd.locationRegion,
        searchRadiusKm: jd.searchRadiusKm,
      },
      candidate: { latitude: c.latitude, longitude: c.longitude },
    });
    return { candidate: c, match: computeMatchFromScores({ semantic, location }) };
  });

  scored.sort((a, b) => b.match.final - a.match.final);

  const above = scored.filter((s) => s.match.final >= MATCHER_CONFIG.displayThreshold);
  if (above.length > 0) {
    return above.slice(0, MATCHER_CONFIG.maxResults).map((s) => ({ ...s, isFallback: false }));
  }
  return scored
    .slice(0, MATCHER_CONFIG.fallbackTopN)
    .map((s) => ({ ...s, isFallback: true }));
}

function applyLocationFilter(jd: JdForMatching, candidates: Candidate[]): Candidate[] {
  if (!MATCHER_CONFIG.locationFilter.enabled) return candidates;
  const jdCoords = resolveJdCoords(jd);
  if (!jdCoords) return candidates;
  const radius = Math.max(1, jd.searchRadiusKm);

  return candidates.filter((c) => {
    if (c.latitude == null || c.longitude == null) return true;
    const distance = haversineKm(jdCoords, { latitude: c.latitude, longitude: c.longitude });
    return distance <= radius;
  });
}

function resolveJdCoords(jd: JdForMatching): LatLng | null {
  const label = jd.locationMunicipality ?? jd.locationProvince ?? jd.locationRegion;
  if (!label) return null;
  return resolvePlaceCoords(label);
}
