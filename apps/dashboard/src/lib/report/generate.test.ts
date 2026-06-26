import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/llm/mistral", () => ({ callMistralJson: vi.fn(), MistralError: class extends Error {} }));

import { callMistralJson } from "@/lib/llm/mistral";
import { generateReport } from "./generate";

const VALID = {
  intro: "Profilo pratico.",
  domains: [{ id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "ok" }] }],
};

describe("generateReport", () => {
  beforeEach(() => vi.resetAllMocks());

  it("returns the validated report on first success", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValueOnce(VALID);
    const r = await generateReport({ q1: "analitico" });
    expect(r.domains[0]!.id).toBe("technical");
    expect(callMistralJson).toHaveBeenCalledTimes(1);
  });

  it("retries once when the first result is schema-invalid", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ intro: "x", domains: [{ id: "BAD", competences: [] }] })
      .mockResolvedValueOnce(VALID);
    const r = await generateReport({ q1: "analitico" });
    expect(r.intro).toBe("Profilo pratico.");
    expect(callMistralJson).toHaveBeenCalledTimes(2);
  });

  it("throws after a persistent failure (two bad results)", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue({ nope: true });
    await expect(generateReport({ q1: "analitico" })).rejects.toThrow();
    expect(callMistralJson).toHaveBeenCalledTimes(2);
  });
});
