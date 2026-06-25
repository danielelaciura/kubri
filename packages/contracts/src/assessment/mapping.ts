import type { CandidateColumn, QuestionDef, SubFieldDef } from "./types";
import { allQuestions } from "./registry";

export interface MappedColumns {
  workExperience?: string[];
  skillsAndCompetences?: string[];
  educationAndTraining?: string[];
  desiredJob?: string;
  jobConstraints?: string;
  preferredLocation?: string;
  partTimePreference?: boolean;
}

export interface MappedCandidate {
  columns: MappedColumns;
  assessmentProfile: Record<string, unknown>;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]!] !== "object" || cur[parts[i]!] === null) cur[parts[i]!] = {};
    cur = cur[parts[i]!] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}

function asString(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  return v == null ? "" : String(v);
}

const ARRAY_COLUMNS = new Set<CandidateColumn>(["workExperience", "skillsAndCompetences", "educationAndTraining"]);

function applyTarget(
  columns: MappedColumns,
  profile: Record<string, unknown>,
  def: QuestionDef | SubFieldDef,
  value: unknown,
): void {
  const t = def.target;
  if (t.kind === "profile") {
    setPath(profile, t.path, value);
    return;
  }
  const str = asString(value);
  if (t.strategy === "append" && ARRAY_COLUMNS.has(t.field)) {
    if (!str.trim()) return;
    const arr = ((columns as Record<string, string[]>)[t.field] ??= []);
    arr.push(`${def.label}: ${str}`);
  } else {
    (columns as Record<string, unknown>)[t.field] = str;
  }
}

export function mapAssessmentToCandidate(answers: Record<string, unknown>): MappedCandidate {
  const columns: MappedColumns = {};
  const assessmentProfile: Record<string, unknown> = {};
  const byId = new Map(allQuestions().map((q) => [q.id, q] as const));

  for (const [qid, answer] of Object.entries(answers)) {
    if (answer == null) continue;
    const q = byId.get(qid);
    if (!q) continue;
    if (q.component === "repeatable_group") {
      const entries = Array.isArray(answer) ? (answer as Record<string, unknown>[]) : [];
      for (const entry of entries) {
        for (const f of q.fields ?? []) {
          const v = entry[f.id];
          if (v == null || asString(v) === "") continue;
          applyTarget(columns, assessmentProfile, f, v);
        }
      }
      continue;
    }
    applyTarget(columns, assessmentProfile, q, answer);
  }
  return { columns, assessmentProfile };
}
