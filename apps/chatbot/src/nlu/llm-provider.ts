export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/** Spec §8.5. */
export interface LlmRequest {
  readonly messages: readonly LlmMessage[];
  readonly model: string;
  readonly temperature: number;
  /** "json": one JSON object, through the provider's JSON mode; Zod validates it (D80). */
  readonly responseFormat: "json" | "text";
  readonly maxTokens: number;
  readonly timeoutMs: number;
}

export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface LlmResponse {
  readonly content: string;
  /** The model that answered, as the provider names it. */
  readonly model: string;
  readonly usage: LlmUsage | null;
}

/** The only way to reach an LLM (CLAUDE.md). Throws LlmError. */
export interface LlmProvider {
  /** Stored in NluTrace and TranslationCache. */
  readonly name: string;
  complete(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorKind =
  "timeout" | "network" | "rate_limited" | "server" | "client" | "invalid_response";

const RETRYABLE: ReadonlySet<LlmErrorKind> = new Set([
  "timeout",
  "network",
  "rate_limited",
  "server",
  "invalid_response",
]);

/** The message never contains the request or the response body: they hold personal data. */
export class LlmError extends Error {
  readonly kind: LlmErrorKind;
  readonly status: number | undefined;

  constructor(kind: LlmErrorKind, message: string, status?: number) {
    super(message);
    this.name = "LlmError";
    this.kind = kind;
    this.status = status;
  }

  /** D82: worth trying again, then on the fallback model. */
  get retryable(): boolean {
    return RETRYABLE.has(this.kind);
  }
}
