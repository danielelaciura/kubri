import { prisma } from "@/lib/db";
import type { Candidate } from "@/types";
import { MATCHER_CONFIG } from "./config";
import { locationScore } from "./location";
import { MatchingUnavailableError } from "@/lib/embeddings/errors";

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
  const final = Math.round(100 * (w.semantic * scores.semantic + w.location * scores.location));
  return { final, breakdown: { semantic: scores.semantic, location: scores.location } };
}

export async function rankCandidates(
  jd: JdForMatching,
  candidates: Candidate[],
): Promise<RankedCandidate[]> {
  if (!jd.embedding) {
    throw new MatchingUnavailableError("JD has no embedding yet");
  }
  if (candidates.length === 0) return [];

  const vectorLiteral = `[${jd.embedding.join(",")}]`;
  const ids = candidates.map((c) => c.id);

  type Row = { id: string; semantic: number };
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT id::text AS id,
           1 - (embedding <=> ${vectorLiteral}::vector) AS semantic
    FROM "Candidate"
    WHERE id = ANY(${ids}::uuid[])
      AND embedding IS NOT NULL
  `;
  const semanticById = new Map<string, number>(rows.map((r) => [r.id, Number(r.semantic)]));

  const scored = candidates.map((c) => {
    const semantic = semanticById.get(c.id) ?? 0;
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
