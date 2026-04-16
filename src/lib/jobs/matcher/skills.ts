import { tokenSet } from "./tokens";
import { expandTokens } from "./synonyms";

interface CandidateSlice {
  skillsAndCompetences: string[];
  workExperience: string[];
  desiredJob: string;
}

export function skillsScore(params: {
  jdSkills: string[];
  candidate: CandidateSlice;
}): number {
  const { jdSkills, candidate } = params;
  if (jdSkills.length === 0) return 0;

  const jdStems = expandTokens(tokenSet(jdSkills.join(" ")));
  if (jdStems.size === 0) return 0;

  const candidateText = [
    ...candidate.skillsAndCompetences,
    ...candidate.workExperience,
    candidate.desiredJob,
  ].join(" ");
  const candStems = expandTokens(tokenSet(candidateText));
  if (candStems.size === 0) return 0;

  let hit = 0;
  for (const s of jdStems) if (candStems.has(s)) hit++;
  return hit / jdStems.size;
}
