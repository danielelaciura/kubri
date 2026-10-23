import { describe, it, expect, beforeEach, vi } from "vitest";
import { z } from "zod/v4";

vi.mock("@/lib/llm/client", () => ({ chatCompletion: vi.fn() }));

import { chatCompletion } from "@/lib/llm/client";
import { LLMError, LLMTimeoutError } from "@/lib/llm/errors";
import { extractStructured } from "@/lib/llm/structured";

const chat = chatCompletion as unknown as ReturnType<typeof vi.fn>;
const schema = z.object({ name: z.string() });
const base = { schema, system: "sys", user: "usr" };

describe("extractStructured", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns parsed data on the first valid response", async () => {
    chat.mockResolvedValueOnce('{"name":"Ahmed"}');
    await expect(extractStructured(base)).resolves.toEqual({ name: "Ahmed" });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0]![0]).toMatchObject({
      jsonResponse: true,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    });
  });

  it("retries once with the validation error fed back", async () => {
    chat.mockResolvedValueOnce('{"name":42}').mockResolvedValueOnce('{"name":"Ahmed"}');
    await expect(extractStructured(base)).resolves.toEqual({ name: "Ahmed" });
    const retryMessages = chat.mock.calls[1]![0].messages;
    expect(retryMessages).toHaveLength(4);
    expect(retryMessages[2]).toEqual({ role: "assistant", content: '{"name":42}' });
    expect(retryMessages[3].role).toBe("user");
    expect(retryMessages[3].content).toContain("name");
  });

  it("retries once on non-JSON content", async () => {
    chat.mockResolvedValueOnce("sorry").mockResolvedValueOnce('{"name":"A"}');
    await expect(extractStructured(base)).resolves.toEqual({ name: "A" });
  });

  it("throws LLMError after two invalid responses", async () => {
    chat.mockResolvedValue('{"name":42}');
    await expect(extractStructured(base)).rejects.toBeInstanceOf(LLMError);
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("retries transport errors and rethrows the last one", async () => {
    chat.mockRejectedValue(new LLMTimeoutError("timed out"));
    await expect(extractStructured(base)).rejects.toBeInstanceOf(LLMTimeoutError);
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
