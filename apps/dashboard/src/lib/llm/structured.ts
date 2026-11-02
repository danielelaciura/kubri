import type { ZodType } from "zod/v4";
import { chatCompletion, type ChatMessage } from "./client";
import { LLMError } from "./errors";

export interface ExtractStructuredOptions<T> {
  schema: ZodType<T>;
  system: string;
  user: string;
  model?: string;
  temperature?: number;
  timeoutMs?: number;
}

const MAX_ATTEMPTS = 2;

/**
 * Ask Mistral (JSON mode) for an object matching `schema`. On invalid JSON or
 * a schema mismatch it retries once, showing the model its previous answer and
 * the validation issues. Transport errors are retried once as-is. Throws the
 * last LLMError (LLMTimeoutError for timeouts) when every attempt fails.
 * Generic: knows nothing about candidates.
 */
export async function extractStructured<T>(opts: ExtractStructuredOptions<T>): Promise<T> {
  const baseMessages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  let messages = baseMessages;
  let lastErr: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    let content: string;
    try {
      content = await chatCompletion({
        messages,
        jsonResponse: true,
        model: opts.model,
        temperature: opts.temperature,
        timeoutMs: opts.timeoutMs,
      });
    } catch (e) {
      lastErr = e;
      continue;
    }

    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch (e) {
      lastErr = new LLMError("LLM content is not valid JSON", e);
      messages = [
        ...baseMessages,
        { role: "assistant", content },
        { role: "user", content: "The previous answer was not valid JSON. Reply with valid JSON only." },
      ];
      continue;
    }

    const parsed = opts.schema.safeParse(json);
    if (parsed.success) return parsed.data;

    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    lastErr = new LLMError(`LLM output failed schema validation: ${issues}`);
    messages = [
      ...baseMessages,
      { role: "assistant", content },
      {
        role: "user",
        content: `The JSON does not match the required schema (${issues}). Fix it and reply with the corrected JSON only.`,
      },
    ];
  }

  throw lastErr instanceof LLMError
    ? lastErr
    : new LLMError("structured extraction failed", lastErr);
}
