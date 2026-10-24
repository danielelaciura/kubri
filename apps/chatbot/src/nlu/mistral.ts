import { z } from "zod";
import { LlmError, type LlmProvider, type LlmRequest } from "./llm-provider";

/** Mistral's La Plateforme, hosted in the EU (spec §8.5, D10). */
export const MISTRAL_BASE_URL = "https://api.mistral.ai";
const CHAT_PATH = "/v1/chat/completions";
export const MISTRAL_CHAT_URL = `${MISTRAL_BASE_URL}${CHAT_PATH}`;

/** A longer Retry-After is not worth a candidate waiting: fall through to retries/fallback. */
const MAX_RETRY_AFTER_MS = 5000;

const ResponseSchema = z.object({
  model: z.string(),
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().nullable().optional() }),
        finish_reason: z.string().nullable().optional(),
      }),
    )
    .min(1),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).optional(),
});

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface MistralOptions {
  readonly apiKey: string;
  /** Injected by tests: they never reach the real API. */
  readonly fetch?: FetchLike;
  /** For tests and private endpoints. Default: Mistral's La Plateforme. */
  readonly baseUrl?: string;
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
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const value = header.trim();
  let ms: number;
  if (/^\d+$/.test(value)) {
    ms = Number(value) * 1000;
  } else {
    const date = Date.parse(value);
    if (Number.isNaN(date)) return undefined;
    ms = Math.max(0, date - Date.now());
  }
  return Math.min(ms, MAX_RETRY_AFTER_MS);
}

function httpError(status: number, retryAfter: string | null): LlmError {
  const message = `Mistral HTTP ${status}`;
  if (status === 408) return new LlmError("timeout", message, status);
  if (status === 429)
    return new LlmError("rate_limited", message, status, parseRetryAfter(retryAfter));
  if (status >= 500) return new LlmError("server", message, status);
  return new LlmError("client", message, status);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

export function createMistralProvider({
  apiKey,
  fetch: fetchImpl = fetch,
  baseUrl = MISTRAL_BASE_URL,
}: MistralOptions): LlmProvider {
  return {
    name: "mistral",
    async complete(request) {
      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${CHAT_PATH}`, {
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
        throw httpError(response.status, response.headers.get("retry-after"));
      }
      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error: unknown) {
        // The timeout signal also covers reading the body.
        if (isTimeout(error)) {
          throw new LlmError("timeout", `Mistral timed out after ${request.timeoutMs} ms`);
        }
        throw new LlmError("invalid_response", "Mistral returned a body that is not JSON");
      }
      const parsed = ResponseSchema.safeParse(payload);
      const content = parsed.success ? parsed.data.choices[0]?.message.content : undefined;
      if (!parsed.success || !content) {
        throw new LlmError("invalid_response", "Mistral returned an unexpected body");
      }
      if (parsed.data.choices[0]?.finish_reason === "length") {
        throw new LlmError("invalid_response", "Mistral answer was truncated (max tokens reached)");
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
