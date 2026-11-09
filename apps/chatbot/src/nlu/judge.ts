import { z } from "zod";
import type { TranslationKind } from "../i18n/translator";
import { callWithPolicy, type CallTiming } from "./call-policy";
import type { NluConfig } from "./config";
import { stripCodeFence } from "./interpretation-output";
import type { LlmProvider } from "./llm-provider";
import { JUDGE_SYSTEM_PROMPT } from "./prompts/judge-v1";

const JudgeOutputSchema = z.strictObject({
  fidelity: z.number().int().min(1).max(5),
  naturalness: z.number().int().min(1).max(5),
  issues: z.array(z.string()).default([]),
});

/** The grades of one translation (D100), and the model that gave them. */
export interface JudgeScore extends z.infer<typeof JudgeOutputSchema> {
  /** As the provider reported it: an alias like `-latest` resolves to a dated model. */
  readonly model: string;
}

export interface JudgeInput {
  readonly source: string;
  readonly translation: string;
  readonly language: string;
  readonly kind: TranslationKind;
}

/** The evals judge of translations (plan 07). Only nlu talks to the LLM provider. */
export interface Judge {
  /** null = no usable grade (LLM unavailable or invalid reply). */
  score(input: JudgeInput): Promise<JudgeScore | null>;
}

export interface JudgeOptions {
  readonly provider: LlmProvider;
  readonly model: string;
  readonly timeoutMs: number;
  readonly timing: CallTiming;
}

const JUDGE_MAX_TOKENS = 500;

async function scoreWithLlm(input: JudgeInput, options: JudgeOptions): Promise<JudgeScore | null> {
  const result = await callWithPolicy(
    options.provider,
    {
      messages: [
        { role: "system", content: JUDGE_SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            targetLanguage: input.language,
            kind: input.kind,
            source: input.source,
            translation: input.translation,
          }),
        },
      ],
      model: options.model,
      temperature: 0,
      responseFormat: "json",
      maxTokens: JUDGE_MAX_TOKENS,
      timeoutMs: options.timeoutMs,
    },
    // E8: no fallback model. Another model is another instrument, with no calibration.
    options.model,
    options.timing,
  );
  if (!result.response) return null;
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFence(result.response.content));
  } catch {
    return null;
  }
  const parsed = JudgeOutputSchema.safeParse(json);
  return parsed.success ? { ...parsed.data, model: result.response.model } : null;
}

export function createLlmJudge(options: JudgeOptions): Judge {
  return { score: (input) => scoreWithLlm(input, options) };
}

/**
 * D100: a model must not grade its own translations. The fallback model translates when the
 * translate model fails (D82), so the judge must differ from both.
 */
export function assertIndependentJudge(models: NluConfig["models"]): void {
  if (models.judge === models.translate) {
    throw new Error(
      "NLU_JUDGE_MODEL must differ from NLU_TRANSLATE_MODEL: a model must not grade its own translations",
    );
  }
  if (models.judge === models.fallback) {
    throw new Error(
      "NLU_JUDGE_MODEL must differ from NLU_FALLBACK_MODEL: the fallback translates when the translator fails, and a model must not grade its own translations",
    );
  }
}
