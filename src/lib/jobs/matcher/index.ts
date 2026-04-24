import type { Candidate } from "@/types";
import { MATCHER_CONFIG } from "./config";
import { skillsScore } from "./skills";
import { descriptionScore } from "./description";
import { locationScore } from "./location";

export interface JdForMatching {
  description: string;
  skills: string[];
  locationMunicipality?: string | null;
  locationProvince?: string | null;
  locationRegion?: string | null;
}

export interface MatchResult {
  final: number;
  breakdown: {
    skills: number;
    description: number;
    location: number;
  };
}

export function computeMatch(jd: JdForMatching, c: Candidate): MatchResult {
  const slice = {
    skillsAndCompetences: c.skillsAndCompetences,
    workExperience: c.workExperience,
    desiredJob: c.jobPreferences.desiredJob,
  };
  const candidateLoc = c.jobPreferences.preferredLocation || c.address;
  const breakdown = {
    skills: skillsScore({ jdSkills: jd.skills, candidate: slice }),
    description: descriptionScore({ jdDescription: jd.description, candidate: slice }),
    location: locationScore({
      jd: {
        municipality: jd.locationMunicipality,
        province: jd.locationProvince,
        region: jd.locationRegion,
      },
      candidateLocation: candidateLoc,
    }),
  };
  const w = MATCHER_CONFIG.weights;
  const final = Math.round(
    100 * (w.skills * breakdown.skills + w.description * breakdown.description + w.location * breakdown.location)
  );
  return { final, breakdown };
}

export interface RankedCandidate {
  candidate: Candidate;
  match: MatchResult;
  isFallback: boolean;
}

export function rankCandidates(jd: JdForMatching, candidates: Candidate[]): RankedCandidate[] {
  const scored = candidates
    .map((c) => ({ candidate: c, match: computeMatch(jd, c) }))
    .sort((a, b) => b.match.final - a.match.final);

  const aboveThreshold = scored.filter((s) => s.match.final >= MATCHER_CONFIG.displayThreshold);
  if (aboveThreshold.length > 0) {
    return aboveThreshold
      .slice(0, MATCHER_CONFIG.maxResults)
      .map((s) => ({ ...s, isFallback: false }));
  }
  return scored
    .slice(0, MATCHER_CONFIG.fallbackTopN)
    .map((s) => ({ ...s, isFallback: true }));
}
