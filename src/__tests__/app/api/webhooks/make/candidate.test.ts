import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: {
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/db";
import { POST } from "@/app/api/webhooks/make/candidate/route";

const SECRET = "test-secret-xyz";

function makeRequest(body: unknown, auth?: string): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== undefined) headers["Authorization"] = auth;
  return new Request("http://localhost/api/webhooks/make/candidate", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/webhooks/make/candidate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env["MAKE_WEBHOOK_SECRET"] = SECRET;
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await POST(
      makeRequest({ key: "k", makeDatastoreId: "ds", data: {} }),
    );
    expect(res.status).toBe(401);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization secret is wrong", async () => {
    const res = await POST(
      makeRequest(
        { key: "k", makeDatastoreId: "ds", data: {} },
        "Bearer wrong",
      ),
    );
    expect(res.status).toBe(401);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when body is not valid JSON", async () => {
    const res = await POST(makeRequest("{not json", `Bearer ${SECRET}`));
    expect(res.status).toBe(400);
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 400 when schema validation fails (missing key)", async () => {
    const res = await POST(
      makeRequest(
        { makeDatastoreId: "ds", data: {} },
        `Bearer ${SECRET}`,
      ),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("validation_failed");
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("returns 200 and upserts on happy path", async () => {
    vi.mocked(prisma.candidate.upsert).mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
    } as never);

    const res = await POST(
      makeRequest(
        {
          key: "ext_123",
          makeDatastoreId: "ds_abc",
          data: { first_name: "Mario", interview_complete: true },
        },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.candidateId).toBe("11111111-1111-1111-1111-111111111111");

    expect(prisma.candidate.upsert).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.candidate.upsert).mock.calls[0]![0];
    expect(arg.where).toEqual({
      makeDatastoreId_externalId: {
        makeDatastoreId: "ds_abc",
        externalId: "ext_123",
      },
    });
    expect(arg.create.firstName).toBe("Mario");
    expect(arg.update.firstName).toBe("Mario");
  });

  it("returns 500 when prisma throws", async () => {
    vi.mocked(prisma.candidate.upsert).mockRejectedValue(new Error("db down"));

    const res = await POST(
      makeRequest(
        { key: "k", makeDatastoreId: "ds", data: {} },
        `Bearer ${SECRET}`,
      ),
    );

    expect(res.status).toBe(500);
    const json = await res.json();
    expect(json.error).toBe("internal_error");
  });
});
