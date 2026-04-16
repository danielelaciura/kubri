import { resolveLocation } from "@/lib/geo/resolve";

interface JdLocation {
  municipality?: string | null;
  province?: string | null;
  region?: string | null;
}

export function locationScore(params: {
  jd: JdLocation;
  candidateLocation: string;
}): number {
  const { jd, candidateLocation } = params;
  const jdResolved: JdLocation = {
    municipality: jd.municipality ?? undefined,
    province: jd.province ?? undefined,
    region: jd.region ?? undefined,
  };
  if (!jdResolved.municipality && !jdResolved.province && !jdResolved.region) return 0.5;

  if (!candidateLocation?.trim()) return 0.5;
  const cand = resolveLocation(candidateLocation);
  if (cand.confidence === "none") return 0.5;

  if (jdResolved.municipality && cand.municipality && jdResolved.municipality === cand.municipality) return 1.0;
  if (jdResolved.province && cand.province && jdResolved.province === cand.province) return 0.8;
  if (jdResolved.region && cand.region && jdResolved.region === cand.region) return 0.6;
  return 0.0;
}
