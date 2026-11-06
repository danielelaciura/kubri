import { z } from "zod";
import type { Translation, TranslationRequest, Translator } from "../i18n/translator";
import { callWithPolicy } from "./call-policy";
import { stripCodeFence } from "./interpretation-output";
import type { LlmMessage } from "./llm-provider";
import type { LlmTaskOptions } from "./llm-task";
import { TRANSLATE_PROMPT_VERSION, TRANSLATE_SYSTEM_PROMPT } from "./prompts/translate-v1";
import { attemptTraces, traceInput, writeTracesSafely } from "./trace";

const TranslationOutputSchema = z.strictObject({ text: z.string().trim().min(1) });
const TRANSLATE_TEMPERATURE = 0;
const TRANSLATE_MAX_TOKENS = 2000;

function parseTranslation(content: string): string | undefined {
  try {
    const parsed = TranslationOutputSchema.safeParse(JSON.parse(stripCodeFence(content)));
    return parsed.success ? parsed.data.text : undefined;
  } catch {
    return undefined;
  }
}

function translateMessages(request: TranslationRequest): LlmMessage[] {
  return [
    { role: "system", content: TRANSLATE_SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        targetLanguage: request.targetLanguage,
        kind: request.kind,
        text: request.text,
      }),
    },
  ];
}

async function translateWithLlm(
  request: TranslationRequest,
  options: LlmTaskOptions,
): Promise<Translation> {
  const messages = translateMessages(request);
  const result = await callWithPolicy(
    options.provider,
    {
      messages,
      model: options.config.models.translate,
      temperature: TRANSLATE_TEMPERATURE,
      responseFormat: "json",
      maxTokens: TRANSLATE_MAX_TOKENS,
      timeoutMs: options.config.timeoutMs,
    },
    options.config.models.fallback,
    options.timing,
  );
  const text = result.response ? parseTranslation(result.response.content) : undefined;
  await writeTracesSafely(
    options.traces,
    attemptTraces(
      {
        // A new translation is cached and served to everyone: it belongs to no turn.
        turnId: null,
        task: "translate",
        promptVersion: TRANSLATE_PROMPT_VERSION,
        provider: options.provider.name,
        repair: false,
        input: traceInput(messages),
        at: options.now(),
      },
      result.attempts,
      text !== undefined,
      options.config.prices,
    ),
  );
  // D88: no repair; i18n falls back to Italian on any error (D72).
  if (!result.response || text === undefined) {
    throw new Error(`translation to ${request.targetLanguage} unavailable`);
  }
  return { text, provider: options.provider.name, model: result.response.model };
}

/** Spec §8.1 point 2, behind the Translator contract of plan 05 (D88). */
export function createLlmTranslator(options: LlmTaskOptions): Translator {
  return { translate: (request) => translateWithLlm(request, options) };
}
