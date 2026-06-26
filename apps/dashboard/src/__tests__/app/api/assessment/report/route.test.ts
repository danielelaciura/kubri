import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/llm/mistral", () => ({ callMistralJson: vi.fn(), MistralError: class extends Error {} }));

import { callMistralJson } from "@/lib/llm/mistral";
import { POST } from "@/app/api/assessment/report/route";

const SECRET = "test-secret";
const VALID_REPORT = {
  intro: "Profilo pratico.",
  domains: [{ id: "technical", competences: [{ name: "Lavoro manuale", level: "Forte", note: "ok" }] }],
};

function req(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/assessment/report", { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/assessment/report", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = SECRET;
    process.env["MISTRAL_API_KEY"] = "x";
  });

  it("401 without secret", async () => {
    expect((await POST(req({ assessment: {} }))).status).toBe(401);
  });

  it("200 application/pdf on valid input", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_REPORT);
    const res = await POST(req({ assessment: { q1: "analitico" }, name: "Mario Rossi" }, `Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it("never forwards PII (name) to the LLM", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_REPORT);
    await POST(req({ assessment: { q1: "analitico" }, name: "Mario Rossi" }, `Bearer ${SECRET}`));
    const [system, user] = (callMistralJson as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(system + user).not.toContain("Mario");
  });

  it("502 after persistent LLM failure", async () => {
    (callMistralJson as ReturnType<typeof vi.fn>).mockResolvedValue({ nope: true });
    const res = await POST(req({ assessment: { q1: "analitico" } }, `Bearer ${SECRET}`));
    expect(res.status).toBe(502);
  });
});
