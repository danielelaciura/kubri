import { LlmError, type LlmProvider, type LlmRequest, type LlmResponse } from "./llm-provider";

/** A reply: the content, an error to throw, or content computed from the request. */
export type FakeReply = string | LlmError | ((request: LlmRequest) => string);

/** For tests: tests never call the real LLM (CLAUDE.md). */
export class FakeLlmProvider implements LlmProvider {
  readonly name = "fake";
  readonly requests: LlmRequest[] = [];
  private readonly replies: FakeReply[];

  constructor(replies: readonly FakeReply[] = []) {
    this.replies = [...replies];
  }

  enqueue(...replies: FakeReply[]): void {
    this.replies.push(...replies);
  }

  complete(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const reply = this.replies.shift();
    if (reply === undefined) {
      return Promise.reject(new LlmError("server", "FakeLlmProvider: no reply queued"));
    }
    if (reply instanceof LlmError) return Promise.reject(reply);
    const content = typeof reply === "function" ? reply(request) : reply;
    return Promise.resolve({
      content,
      model: request.model,
      usage: { inputTokens: 100, outputTokens: 20 },
    });
  }
}
