import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    candidate: { findUnique: vi.fn(), upsert: vi.fn() },
    $executeRaw: vi.fn(),
  },
}));

vi.mock("@/lib/pools/resolve", async () => {
  const actual = await vi.importActual<typeof import("@/lib/pools/resolve")>("@/lib/pools/resolve");
  return { ...actual, resolvePoolByExternalKey: vi.fn() };
});

vi.mock("@/lib/embeddings/client", () => ({
  generateEmbedding: vi.fn(),
  vectorToPgLiteral: (v: number[]) => `[${v.join(",")}]`,
}));

vi.mock("@/lib/geo/google", async () => {
  const actual = await vi.importActual<typeof import("@/lib/geo/google")>("@/lib/geo/google");
  return { ...actual, googleMapsConfigured: vi.fn(), geocodeAddress: vi.fn() };
});

import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE } from "@kubri/contracts";
import { prisma } from "@/lib/db";
import { resolvePoolByExternalKey, UnknownPoolError } from "@/lib/pools/resolve";
import { generateEmbedding } from "@/lib/embeddings/client";
import { geocodeAddress, googleMapsConfigured, GoogleMapsUnavailableError } from "@/lib/geo/google";
import { POST } from "@/app/api/webhooks/chatbot/candidate/route";

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;
const SECRET = "chatbot-secret-xyz";
const CANDIDATE_ID = "11111111-1111-1111-1111-111111111111";
const POOL = {
  id: "00000000-0000-0000-0000-000000000001",
  name: "Global",
  externalKey: "global",
  isGlobal: true,
  globalSharing: "WEBHOOK",
  createdAt: new Date("2026-01-01T00:00:00Z"),
};
const GOOGLE_PLACE = {
  placeId: "ChIJbo", formattedAddress: "Via Giuseppe Garibaldi, 12, 40124 Bologna BO, Italia",
  latitude: 44.49, longitude: 11.34, municipality: "Bologna", provinceCode: "BO",
};

type Payload = { key: string; externalKey: string; data: Record<string, unknown> };
const example = (): Payload => structuredClone(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE) as Payload;

/** `auth: null` sends no Authorization header. */
function request(body: unknown, auth: string | null = `Bearer ${SECRET}`): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  return new Request("http://localhost/api/webhooks/chatbot/candidate", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** The data written by ingestCandidate (create and update carry the same object). */
function written(): Record<string, unknown> {
  const call = m(prisma.candidate.upsert).mock.calls[0]?.[0] as { create: Record<string, unknown> };
  return call.create;
}

describe("POST /api/webhooks/chatbot/candidate", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env["CHATBOT_WEBHOOK_SECRET"] = SECRET;
    m(resolvePoolByExternalKey).mockResolvedValue(POOL);
    m(prisma.candidate.findUnique).mockResolvedValue(null);
    m(prisma.candidate.upsert).mockResolvedValue({
      id: CANDIDATE_ID,
      skillsAndCompetences: ["uso del muletto"],
      workExperience: [],
      educationAndTraining: [],
      desiredJob: "magazziniere",
      jobConstraints: null,
    });
    m(generateEmbedding).mockResolvedValue(Array.from({ length: 384 }, () => 0.1));
    m(prisma.$executeRaw).mockResolvedValue(1);
    m(googleMapsConfigured).mockReturnValue(true);
    m(geocodeAddress).mockResolvedValue(GOOGLE_PLACE);
  });

  describe("authentication", () => {
    it.each([
      ["no Authorization header", null],
      ["a wrong secret", "Bearer wrong"],
      ["the secret without Bearer", SECRET],
      ["a longer secret", `Bearer ${SECRET}x`],
    ])("returns 401 with %s", async (_name, auth) => {
      const res = await POST(request(example(), auth));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
      expect(resolvePoolByExternalKey).not.toHaveBeenCalled();
      expect(prisma.candidate.upsert).not.toHaveBeenCalled();
    });

    it.each([["unset", undefined], ["empty", ""], ["blank", "  "]])(
      "always returns 401 when the server secret is %s",
      async (_name, value) => {
        if (value === undefined) delete process.env["CHATBOT_WEBHOOK_SECRET"];
        else process.env["CHATBOT_WEBHOOK_SECRET"] = value;
        for (const auth of [null, "Bearer ", `Bearer ${value ?? "undefined"}`]) {
          expect((await POST(request(example(), auth))).status).toBe(401);
        }
        expect(prisma.candidate.upsert).not.toHaveBeenCalled();
      },
    );
  });

  describe("validation", () => {
    it("returns 400 on a body that is not JSON", async () => {
      const res = await POST(request("{not json"));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid_json" });
    });

    it("returns 400 validation_failed with the issue paths only, never the values", async () => {
      const payload = example();
      payload.data.phone = "393334445566";
      payload.data.channel = "telegram";
      const res = await POST(request(payload));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe("validation_failed");
      expect(json.issues.map((i: { path: string }) => i.path).sort()).toEqual(["data.channel", "data.phone"]);
      expect(JSON.stringify(json)).not.toContain("393334445566");
      const logged = JSON.stringify(m(console.error).mock.calls);
      expect(logged).not.toContain("393334445566");
      expect(prisma.candidate.upsert).not.toHaveBeenCalled();
    });

    it("refuses a payload with coordinates (the dashboard geocodes)", async () => {
      const payload = example();
      payload.data.lat = 1;
      const res = await POST(request(payload));
      expect(res.status).toBe(400);
    });
  });

  it("returns 422 unknown_pool when the external key matches no pool", async () => {
    m(resolvePoolByExternalKey).mockRejectedValue(new UnknownPoolError("nope"));
    const res = await POST(request({ ...example(), externalKey: "nope" }));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ error: "unknown_pool", externalKey: "nope" });
    expect(prisma.candidate.findUnique).not.toHaveBeenCalled();
    expect(prisma.candidate.upsert).not.toHaveBeenCalled();
  });

  it("creates the candidate through ingestCandidate, with Google coordinates", async () => {
    const res = await POST(request(example()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, candidateId: CANDIDATE_ID });

    expect(prisma.candidate.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { poolId_externalId: { poolId: POOL.id, externalId: CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.key } },
      }),
    );
    expect(geocodeAddress).toHaveBeenCalledWith("Via Garibaldi 12, Bologna");
    const upsert = m(prisma.candidate.upsert).mock.calls[0]?.[0];
    expect(upsert.where).toEqual({
      poolId_externalId: { poolId: POOL.id, externalId: CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.key },
    });
    expect(upsert.update).toEqual(upsert.create);
    expect(written()).toMatchObject({
      address: "Via Garibaldi 12",
      location: "Bologna (BO)",
      latitude: 44.49,
      longitude: 11.34,
      channel: "whatsapp",
      sourceOrganization: "kubri-chatbot",
      learningPreference: "corso per il muletto",
      sourceUpdatedAt: new Date(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.data.last_updated),
    });
    expect(generateEmbedding).toHaveBeenCalled();
  });

  it("falls back to the ISTAT comune when Google is down", async () => {
    m(geocodeAddress).mockRejectedValue(new GoogleMapsUnavailableError("down"));
    const res = await POST(request(example()));
    expect(res.status).toBe(200);
    expect(written()).toMatchObject({
      location: "Bologna (BO)",
      latitude: expect.any(Number),
      longitude: expect.any(Number),
    });
  });

  it("keeps the declared location and null coordinates when nothing matches", async () => {
    m(geocodeAddress).mockResolvedValue(null);
    const res = await POST(request(example()));
    expect(res.status).toBe(200);
    expect(written()).toMatchObject({ location: "Bologna", latitude: null, longitude: null });
  });

  it("geocodes the location alone when there is no address, and nothing when there is neither", async () => {
    const onlyLocation = example();
    delete onlyLocation.data.address;
    await POST(request(onlyLocation));
    expect(geocodeAddress).toHaveBeenCalledWith("Bologna");

    m(geocodeAddress).mockClear();
    m(prisma.candidate.upsert).mockClear();
    const neither = example();
    delete neither.data.address;
    delete neither.data.location;
    const res = await POST(request(neither));
    expect(res.status).toBe(200);
    expect(geocodeAddress).not.toHaveBeenCalled();
    expect(written()).toMatchObject({ location: null, latitude: null, longitude: null });
  });

  describe("an existing candidate", () => {
    const stored = (over: Record<string, unknown> = {}) => ({
      sourceUpdatedAt: new Date("2026-10-24T10:00:00.000Z"),
      location: "Bologna (BO)",
      latitude: 44.5,
      longitude: 11.3,
      rawPayload: example(),
      ...over,
    });

    it("is updated, reusing the stored coordinates when address and location are unchanged", async () => {
      m(prisma.candidate.findUnique).mockResolvedValue(stored());
      const newer = example();
      newer.data.last_updated = "2026-10-25T08:00:00.000Z";
      newer.data.work_experience = ["2018 - 2022 Bologna: Magazziniere"];

      const res = await POST(request(newer));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, candidateId: CANDIDATE_ID });
      expect(geocodeAddress).not.toHaveBeenCalled();
      expect(written()).toMatchObject({
        location: "Bologna (BO)",
        latitude: 44.5,
        longitude: 11.3,
        workExperience: ["2018 - 2022 Bologna: Magazziniere"],
      });
    });

    it("is geocoded again when the address changed", async () => {
      m(prisma.candidate.findUnique).mockResolvedValue(stored());
      const moved = example();
      moved.data.last_updated = "2026-10-25T08:00:00.000Z";
      moved.data.address = "Via Indipendenza 3";
      await POST(request(moved));
      expect(geocodeAddress).toHaveBeenCalledWith("Via Indipendenza 3, Bologna");
      expect(written()).toMatchObject({ latitude: 44.49, longitude: 11.34 });
    });

    it("is geocoded again when it has no stored coordinates", async () => {
      m(prisma.candidate.findUnique).mockResolvedValue(stored({ latitude: null, longitude: null }));
      await POST(request(example()));
      expect(geocodeAddress).toHaveBeenCalledTimes(1);
    });

    it("is not written when the stored profile is newer (stale send)", async () => {
      m(prisma.candidate.findUnique).mockResolvedValue(
        stored({ sourceUpdatedAt: new Date("2026-10-24T11:00:00.000Z") }),
      );
      const res = await POST(request(example()));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, skipped: "stale" });
      expect(prisma.candidate.upsert).not.toHaveBeenCalled();
      expect(geocodeAddress).not.toHaveBeenCalled();
    });

    it("compares instants, not strings, for the stale check", async () => {
      m(prisma.candidate.findUnique).mockResolvedValue(
        stored({ sourceUpdatedAt: new Date("2026-10-24T10:30:00.000Z") }),
      );
      const sameInstant = example();
      sameInstant.data.last_updated = "2026-10-24T12:30:00+02:00";
      const res = await POST(request(sameInstant));
      expect(await res.json()).toEqual({ ok: true, candidateId: CANDIDATE_ID });
    });
  });

  it("returns 500 without details when the upsert fails", async () => {
    m(prisma.candidate.upsert).mockRejectedValue(new Error("db down for Karim"));
    const res = await POST(request(example()));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "internal_error" });
    expect(JSON.stringify(m(console.error).mock.calls)).not.toContain("Karim");
  });
});
