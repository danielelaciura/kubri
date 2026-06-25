import { z } from "zod/v4";
import type { QuestionDef, SubFieldDef } from "./types";
import { allQuestions } from "./registry";

function fieldSchema(q: QuestionDef | SubFieldDef): z.ZodTypeAny {
  switch (q.component) {
    case "single_choice":
    case "select": {
      const values =
        q.component === "single_choice"
          ? (q.options ?? []).map((o) => o.value)
          : (q.selectOptions ?? []);
      return z.string().refine((v) => values.includes(v), "value not in options");
    }
    case "multi_choice": {
      const values = (q.options ?? []).map((o) => o.value);
      return z.array(z.string().refine((v) => values.includes(v), "value not in options"));
    }
    case "scale": {
      const s = q.scale!;
      return z.number().int().min(s.min).max(s.max);
    }
    case "text":
    case "textarea":
      return z.string();
    case "repeatable_group": {
      const shape: Record<string, z.ZodTypeAny> = {};
      for (const f of (q as QuestionDef).fields ?? []) shape[f.id] = fieldSchema(f).optional();
      return z.array(z.object(shape));
    }
  }
  // unreachable; satisfies the type checker
  return z.unknown();
}

function buildAnswersSchema(): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const q of allQuestions()) shape[q.id] = fieldSchema(q).optional();
  return z.object(shape);
}

export const assessmentAnswersSchema = buildAnswersSchema();
export type AssessmentAnswers = z.infer<typeof assessmentAnswersSchema>;
