export interface CandidateEmbeddingInput {
  skillsAndCompetences: string[];
  workExperience: string[];
  educationAndTraining: string[];
  desiredJob: string | null | undefined;
  jobConstraints: string | null | undefined;
}

export interface JobDescriptionEmbeddingInput {
  name: string;
  description: string;
  skills: string[];
}

function cleanArray(values: string[]): string {
  return values.map((v) => v.trim()).filter((v) => v.length > 0).join(", ");
}

function cleanString(value: string | null | undefined): string {
  return (value ?? "").trim();
}

export function buildCandidateEmbeddingText(input: CandidateEmbeddingInput): string {
  const parts = [
    cleanArray(input.skillsAndCompetences),
    cleanArray(input.workExperience),
    cleanArray(input.educationAndTraining),
    cleanString(input.desiredJob),
    cleanString(input.jobConstraints),
  ];
  return parts.filter((p) => p.length > 0).join("\n");
}

export function buildJobDescriptionEmbeddingText(input: JobDescriptionEmbeddingInput): string {
  const parts = [
    input.name.trim(),
    input.description.trim(),
    cleanArray(input.skills),
  ];
  return parts.filter((p) => p.length > 0).join("\n");
}
