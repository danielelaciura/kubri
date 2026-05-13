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

/**
 * Builds the candidate text fed to the embedding model.
 *
 * Uses a labeled template so the model attends to each "field" as a
 * structured signal rather than a single flat blob. The desired role is
 * repeated at the start and end to amplify its weight in the resulting
 * vector — for blue-collar/service matching, the role label is the most
 * discriminating signal we have.
 */
export function buildCandidateEmbeddingText(input: CandidateEmbeddingInput): string {
  const desiredJob = cleanString(input.desiredJob);
  const skills = cleanArray(input.skillsAndCompetences);
  const experience = cleanArray(input.workExperience);
  const education = cleanArray(input.educationAndTraining);
  const constraints = cleanString(input.jobConstraints);

  const lines: string[] = [];
  if (desiredJob) lines.push(`RUOLO DESIDERATO: ${desiredJob}`);
  if (skills) lines.push(`COMPETENZE: ${skills}`);
  if (experience) lines.push(`ESPERIENZA: ${experience}`);
  if (education) lines.push(`FORMAZIONE: ${education}`);
  if (constraints) lines.push(`VINCOLI: ${constraints}`);
  if (desiredJob) lines.push(`RUOLO DESIDERATO: ${desiredJob}`);
  return lines.join("\n");
}

/**
 * Builds the JD text fed to the embedding model.
 *
 * Same labeled-template strategy. The role title is repeated. Location is
 * intentionally omitted because it's a hard pre-filter, not a scoring
 * signal — including it would only dilute the role/skills vector.
 */
export function buildJobDescriptionEmbeddingText(input: JobDescriptionEmbeddingInput): string {
  const name = input.name.trim();
  const description = input.description.trim();
  const skills = cleanArray(input.skills);

  const lines: string[] = [];
  if (name) lines.push(`RUOLO: ${name}`);
  if (description) lines.push(`DESCRIZIONE: ${description}`);
  if (skills) lines.push(`COMPETENZE RICHIESTE: ${skills}`);
  if (name) lines.push(`RUOLO: ${name}`);
  return lines.join("\n");
}
