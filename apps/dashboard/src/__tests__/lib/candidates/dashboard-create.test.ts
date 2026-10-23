import { describe, it, expect, beforeEach, vi } from "vitest";
import type { CandidateFields } from "@kubri/contracts";

vi.mock("@/lib/candidates/ingest", () => ({ ingestCandidate: vi.fn() }));
vi.mock("@/lib/geo/proximity", () => ({ geocodeFromAddress: vi.fn() }));

import { ingestCandidate } from "@/lib/candidates/ingest";
import { geocodeFromAddress } from "@/lib/geo/proximity";
import {
  buildDashboardCandidateInput,
  createCandidateManually,
} from "@/lib/candidates/dashboard-create";

const ingest = ingestCandidate as unknown as ReturnType<typeof vi.fn>;
const geocode = geocodeFromAddress as unknown as ReturnType<typeof vi.fn>;

const POOL = { id: "pool-1", isGlobal: false, globalSharing: "WEBHOOK" as const };

const FIELDS: CandidateFields = {
  firstName: "Ahmed",
  lastName: "Benali",
  birthday: null,
  countryOfOrigin: "Marocco",
  address: null,
  location: "Milano (MI)",
  phone: "+393451234567",
  email: null,
  workingPermit: true,
  meanOfTransport: null,
  drivingLicense: null,
  educationAndTraining: [],
  workExperience: ["Magazziniere"],
  skillsAndCompetences: [],
  language: "Arabo",
  additionalLanguages: [],
  italianLevel: "B1",
  desiredJob: "Magazziniere",
  partTimePreference: null,
  preferredLocation: null,
  jobConstraints: null,
};

describe("buildDashboardCandidateInput", () => {
  beforeEach(() => vi.resetAllMocks());

  it("maps fields, sets dashboard identity and geocodes the location", () => {
    geocode.mockReturnValueOnce({ latitude: 45.46, longitude: 9.19 });
    const input = buildDashboardCandidateInput({
      pool: POOL,
      fields: FIELDS,
      channel: "dashboard_form",
      rawPayload: { mode: "form" },
    });
    expect(input.externalId).toMatch(/^dashboard:[0-9a-f-]{36}$/);
    expect(input.poolId).toBe("pool-1");
    expect(input.channel).toBe("dashboard_form");
    expect(input.firstName).toBe("Ahmed");
    expect(input.workExperience).toEqual(["Magazziniere"]);
    expect(input.latitude).toBe(45.46);
    expect(input.sharedWithGlobal).toBe(false);
    expect(input.rawPayload).toEqual({ mode: "form" });
  });

  it("honours a pool forced to ALWAYS share", () => {
    const input = buildDashboardCandidateInput({
      pool: { ...POOL, globalSharing: "ALWAYS" },
      fields: FIELDS,
      channel: "dashboard_cv",
      rawPayload: {},
    });
    expect(input.sharedWithGlobal).toBe(true);
  });
});

describe("createCandidateManually", () => {
  beforeEach(() => vi.resetAllMocks());

  it("ingests with channel dashboard_form and the submitted fields in rawPayload", async () => {
    ingest.mockResolvedValueOnce({ candidateId: "c-1" });
    const r = await createCandidateManually({ pool: POOL, fields: FIELDS, userId: "u-1" });
    expect(r).toEqual({ candidateId: "c-1" });
    const [data, tag] = ingest.mock.calls[0]!;
    expect(data.channel).toBe("dashboard_form");
    expect(data.rawPayload).toEqual({ mode: "form", createdById: "u-1", submitted: FIELDS });
    expect(tag).toBe("dashboard create");
  });
});
