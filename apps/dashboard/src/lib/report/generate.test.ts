import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/client", () => ({ chatCompletion: vi.fn() }));

import { chatCompletion } from "@/lib/llm/client";
import { generateReport } from "./generate";

const chat = chatCompletion as unknown as ReturnType<typeof vi.fn>;

const VALID = {
  intro: "Profilo pratico.",
  domains: [{ id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "ok" }] }],
};

describe("generateReport", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the validated report on first success", async () => {
    chat.mockResolvedValueOnce(JSON.stringify(VALID));
    const r = await generateReport({ q1: "analitico" });
    expect(r.domains[0]!.id).toBe("technical");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first result is schema-invalid", async () => {
    chat
      .mockResolvedValueOnce(JSON.stringify({ intro: "x", domains: [{ id: "BAD", competences: [] }] }))
      .mockResolvedValueOnce(JSON.stringify(VALID));
    const r = await generateReport({ q1: "analitico" });
    expect(r.intro).toBe("Profilo pratico.");
    expect(chat).toHaveBeenCalledTimes(2);
  });

  it("throws after a persistent failure (two bad results)", async () => {
    chat.mockResolvedValue(JSON.stringify({ nope: true }));
    await expect(generateReport({ q1: "analitico" })).rejects.toThrow();
    expect(chat).toHaveBeenCalledTimes(2);
  });
});
