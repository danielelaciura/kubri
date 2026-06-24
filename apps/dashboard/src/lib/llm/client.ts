import { LLMError } from "./errors";

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 30000;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  jsonResponse?: boolean;
  timeoutMs?: number;
}

interface MistralResponse {
  choices: Array<{ message: { content: string } }>;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

/**
 * Minimal Mistral chat completion wrapper. Server-side only.
 *
 * Reads MISTRAL_API_KEY from the environment. Throws LLMError on any
 * transport, status, or parsing failure so callers can decide whether
 * to surface the error or fall back to embedding-only ranking.
 */
export async function chatCompletion(opts: ChatCompletionOptions): Promise<string> {
  const apiKey = process.env["MISTRAL_API_KEY"];
  if (!apiKey) throw new LLMError("MISTRAL_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(MISTRAL_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: opts.model ?? "mistral-small-latest",
        temperature: opts.temperature ?? 0.2,
        messages: opts.messages,
        ...(opts.jsonResponse ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw new LLMError("Mistral request failed", e);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new LLMError(`Mistral HTTP ${res.status}: ${body}`);
  }

  let data: MistralResponse;
  try {
    data = (await res.json()) as MistralResponse;
  } catch (e) {
    throw new LLMError("Mistral response is not JSON", e);
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new LLMError("Mistral response has no message content");
  }
  return content;
}
