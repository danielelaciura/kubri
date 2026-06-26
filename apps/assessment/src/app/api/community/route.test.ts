import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "./route";

function makeReq(body: unknown): Request {
  return new Request("http://localhost/api/community", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = {
  contact: {
    firstName: "Amir",
    lastName: "K",
    phone: "+393331234567",
    location: "Roma (RM)",
    latitude: 41.89,
    longitude: 12.48,
    privacyAccepted: true as const,
  },
  assessment: { q1: "analitico" },
};

describe("POST /api/community", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env["DASHBOARD_WEBHOOK_URL"] =
      "https://dash.example/api/webhooks/assessment";
    process.env["ASSESSMENT_WEBHOOK_SECRET"] = "s3cr3t";
  });

  it("returns 400 on an invalid payload", async () => {
    const res = await POST(makeReq({ contact: {}, assessment: {} }));
    expect(res.status).toBe(400);
  });

  it("forwards a valid payload to the dashboard webhook with the secret", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 200 }));
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://dash.example/api/webhooks/assessment");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer s3cr3t",
    });
  });

  it("returns 502 when the dashboard webhook rejects", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(502);
  });

  it("returns 500 when webhook config is missing", async () => {
    delete process.env["DASHBOARD_WEBHOOK_URL"];
    const res = await POST(makeReq(VALID));
    expect(res.status).toBe(500);
  });
});
