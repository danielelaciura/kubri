export class LLMError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "LLMError";
  }
}

/** The request was aborted by our own timeout. Retryable. */
export class LLMTimeoutError extends LLMError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "LLMTimeoutError";
  }
}
