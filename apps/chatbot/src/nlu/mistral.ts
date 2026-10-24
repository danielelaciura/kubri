import { z } from "zod";
import { LlmError, type LlmProvider, type LlmRequest } from "./llm-provider";

/** Mistral's La Plateforme, hosted in the EU (spec §8.5, D10). */
export const MISTRAL_CHAT_URL = "https://api.mistral.ai/v1/chat/completions";

const ResponseSchema = z.object({
  model: z.string(),
  choices: z
    .array(z.object({ message: z.object({ content: z.string().nullable().optional() }) }))
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface MistralOptions {
  readonly apiKey: string;
  /** Injected by tests: they never reach the real API. */
  readonly fetch?: FetchLike;
}

function body(request: LlmRequest): Record<string, unknown> {
  return {
    model: request.model,
    messages: request.messages.map(({ role, content }) => ({ role, content })),
    temperature: request.temperature,
    max_tokens: request.maxTokens,
    ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
  };
}

// D80: status only, never the body (it may echo the prompt, which holds personal data).
function httpError(status: number): LlmError {
  const message = `Mistral HTTP ${status}`;
  if (status === 408) return new LlmError("timeout", message, status);
  if (status === 429) return new LlmError("rate_limited", message, status);
  if (status >= 500) return new LlmError("server", message, status);
  return new LlmError("client", message, status);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export function createMistralProvider({
  apiKey,
  fetch: fetchImpl = fetch,
}: MistralOptions): LlmProvider {
  return {
    name: "mistral",
    async complete(request) {
      let response: Response;
      try {
        response = await fetchImpl(MISTRAL_CHAT_URL, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(body(request)),
          signal: AbortSignal.timeout(request.timeoutMs),
        });
      } catch (error: unknown) {
        throw isTimeout(error)
          ? new LlmError("timeout", `Mistral timed out after ${request.timeoutMs} ms`)
          : new LlmError("network", "Mistral is unreachable");
      }
      if (!response.ok) {
        // Drain the body so the connection is released; its content is not used.
        await response.text().catch(() => "");
        throw httpError(response.status);
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new LlmError("invalid_response", "Mistral returned a body that is not JSON");
      }
      const parsed = ResponseSchema.safeParse(payload);
      const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
      if (!parsed.success || !content) {
        throw new LlmError("invalid_response", "Mistral returned an unexpected body");
      }
      const { usage } = parsed.data;
      return {
        content,
        model: parsed.data.model,
        usage: usage
          ? { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens }
          : null,
      };
    },
  };
}
