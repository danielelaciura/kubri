import { tokenize, stem } from "./tokens";
import { expandTokens } from "./synonyms";

interface CandidateSlice {
  skillsAndCompetences: string[];
  workExperience: string[];
  desiredJob: string;
}

export function descriptionScore(params: {
  jdDescription: string;
  candidate: CandidateSlice;
}): number {
  const jdStems = new Set(tokenize(params.jdDescription).map(stem));
  if (jdStems.size === 0) return 0;

  const candText = [
    ...params.candidate.skillsAndCompetences,
    ...params.candidate.workExperience,
    params.candidate.desiredJob,
  ].join(" ");
  const candStems = expandTokens(new Set(tokenize(candText).map(stem)));
  if (candStems.size === 0) return 0;

  let hit = 0;
  for (const s of jdStems) if (candStems.has(s)) hit++;
  return hit / jdStems.size;
}
