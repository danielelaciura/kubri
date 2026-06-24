export class EmbeddingError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}

export class MatchingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MatchingUnavailableError";
  }
}
