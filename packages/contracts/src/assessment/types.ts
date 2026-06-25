/** UI component used to render a question. */
export type ComponentType =
  | "single_choice"
  | "multi_choice"
  | "scale"
  | "text"
  | "textarea"
  | "select"
  | "repeatable_group";

/** Writable Candidate columns an answer may target. */
export type CandidateColumn =
  | "workExperience"
  | "skillsAndCompetences"
  | "educationAndTraining"
  | "desiredJob"
  | "jobConstraints"
  | "preferredLocation"
  | "partTimePreference";

/** Where a question's answer goes. */
export type FieldTarget =
  | { kind: "column"; field: CandidateColumn; strategy: "set" | "append" }
  | { kind: "profile"; path: string };

export interface ChoiceOption { value: string; label: string; }

export interface ScaleConfig { min: number; max: number; default: number; labelMin: string; labelMax: string; }

/** A sub-field inside a repeatable_group. */
export interface SubFieldDef {
  id: string;
  component: Exclude<ComponentType, "repeatable_group">;
  label: string;
  target: FieldTarget;
  options?: ChoiceOption[];
  selectOptions?: string[];
  scale?: ScaleConfig;
  placeholder?: string;
}

export interface QuestionDef {
  id: string;
  component: ComponentType;
  label: string;
  text: string;
  hint?: string;
  target: FieldTarget;
  options?: ChoiceOption[];
  selectOptions?: string[];
  scale?: ScaleConfig;
  fields?: SubFieldDef[];
  placeholder?: string;
}

export interface SectionDef { id: string; title: string; order: number; questions: QuestionDef[]; }
