import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID = { assessment: { q1: "analitico" }, name: "Mario Rossi" };

describe("POST /api/report", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["DASHBOARD_REPORT_URL"] = "https://dash.example/api/assessment/report";
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = "s3cr3t";
  });

  it("forwards to the dashboard with the bearer secret and streams the PDF", async () => {
    const pdf = new Uint8Array([37, 80, 68, 70]); // %PDF
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(pdf, { status: 200, headers: { "Content-Type": "application/pdf" } }),
    );
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash.example/api/assessment/report");
    expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer s3cr3t" });
  });

  it("returns 502 when the dashboard fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(502);
  });

  it("returns 500 when config is missing", async () => {
    delete process.env["DASHBOARD_REPORT_URL"];
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(500);
  });
});
