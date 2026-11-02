import { CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE, chatbotCandidateWebhookSchema } from "@kubri/contracts";
import { describe, expect, it } from "vitest";
import {
  buildKubriPayload,
  KubriContractError,
  type KubriSnapshot,
} from "../../../src/integrations/kubri/payload";

const META = { confidence: 0.95, status: "inferred", source: "extraction" } as const;
const UPDATED_AT = new Date("2026-10-24T10:30:00.000Z");

/** The profile behind the shared example: invented data, as in the contract (CLAUDE.md). */
const SNAPSHOT: KubriSnapshot = {
  contact: { id: "7b0f6c2e-1d0a-4a8e-9d57-3f1c2a9b4e10", phoneE164: "+393334445566" },
  campaign: { id: "2c9f5d8a-6b1e-4c37-8a52-9e0d7f3b1a64", externalKey: "global", version: 3 },
  session: { status: "completed", language: "ar" },
  profile: {
    standard: {
      firstName: "Karim",
      lastName: "Benali",
      birthday: "1990-05-12",
      country: "MA",
      address: "Via Garibaldi 12",
      location: "Bologna",
      email: "karim.benali@example.com",
      workingPermit: true,
      transport: "bicicletta",
      drivingLicense: true,
      drivingLicenseTypes: ["B"],
      educationAndTraining: ["2006 - 2010 Liceo Ibn Rushd (Marocco): Diploma"],
      workExperience: ["2018 - 2020 Bologna: Magazziniere"],
      skillsAndCompetences: ["uso del muletto", "puntualità"],
      language: "ar",
      additionalLanguages: ["francese (intermedio)"],
      italianLevel: "intermedio",
      "jobPreferences.preferredJob": "magazziniere",
      "jobPreferences.partTime": false,
      "jobPreferences.preferredLocation": "Bologna",
      "jobPreferences.constraints": "non lavoro la domenica",
      "jobPreferences.hasDesiredJobExperience": "due anni in magazzino",
      "learningPreferences.isInterested": true,
      "learningPreferences.preference": "corso per il muletto",
    },
    custom: { night_shifts: true },
    fieldMeta: { firstName: META },
    sharedWithGlobal: true,
    updatedAt: UPDATED_AT,
  },
};

const withStandard = (standard: Record<string, unknown>): KubriSnapshot => ({
  ...SNAPSHOT,
  profile: { ...SNAPSHOT.profile, standard, custom: {} },
});

describe("buildKubriPayload (spec §12.1, D123, R4)", () => {
  it("produces exactly the shared contract example (the contract test, §14)", () => {
    expect(buildKubriPayload(SNAPSHOT)).toEqual(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE);
  });

  it("always passes the shared schema", () => {
    expect(chatbotCandidateWebhookSchema.safeParse(buildKubriPayload(SNAPSHOT)).success).toBe(true);
  });

  it("builds the key from the contact and the campaign: two UUIDs, no personal data (D20)", () => {
    expect(buildKubriPayload(SNAPSHOT).key).toBe(`${SNAPSHOT.contact.id}:${SNAPSHOT.campaign.id}`);
  });

  it("omits what is missing instead of sending nulls or blanks", () => {
    const sparse: KubriSnapshot = {
      ...withStandard({ firstName: "Karim", lastName: " ", email: null }),
      session: { status: "active", language: null },
    };

    expect(
      buildKubriPayload({ ...sparse, profile: { ...sparse.profile, sharedWithGlobal: false } })
        .data,
    ).toEqual({
      source_organization: "kubri-chatbot",
      channel: "whatsapp",
      interview_status: "in_progress",
      campaign_version: 3,
      last_updated: "2026-10-24T10:30:00.000Z",
      is_kubri_privacy_accepted: false,
      phone: "+393334445566",
      first_name: "Karim",
    });
  });

  it.each([
    ["active", "in_progress"],
    ["needs_attention", "in_progress"],
    ["completed", "completed"],
    ["stopped", "stopped"],
    ["abandoned", "stopped"],
  ] as const)("maps the session status %s to %s", (status, expected) => {
    const snapshot = { ...SNAPSHOT, session: { ...SNAPSHOT.session, status } };

    expect(buildKubriPayload(snapshot).data.interview_status).toBe(expected);
  });

  it("turns the ISO birthday into dd/mm/yyyy", () => {
    expect(buildKubriPayload(SNAPSHOT).data.birthday).toBe("12/05/1990");
  });

  it("writes last_updated from the profile's updatedAt, in ISO 8601 with its offset", () => {
    const later = new Date("2026-11-02T08:15:30.123Z");
    const snapshot = { ...SNAPSHOT, profile: { ...SNAPSHOT.profile, updatedAt: later } };

    expect(buildKubriPayload(snapshot).data.last_updated).toBe("2026-11-02T08:15:30.123Z");
  });

  it("never sends coordinates nor a CV link: the dashboard geocodes, the CV stays here (D124, D128)", () => {
    const { data } = buildKubriPayload(
      withStandard({ ...SNAPSHOT.profile.standard, lat: 44.49, lng: 11.34 }),
    );

    expect(data).not.toHaveProperty("lat");
    expect(data).not.toHaveProperty("lng");
    expect(data).not.toHaveProperty("cv_link_pdf");
  });

  it("leaves out empty groups", () => {
    const { data } = buildKubriPayload(withStandard({ firstName: "Karim" }));

    expect(data).not.toHaveProperty("job_preferences");
    expect(data).not.toHaveProperty("learning_preferences");
    expect(data).not.toHaveProperty("custom");
  });

  it("names the learning preference as the dashboard reads it (R1)", () => {
    const { data } = buildKubriPayload(
      withStandard({ "learningPreferences.preference": "corso di italiano" }),
    );

    expect(data.learning_preferences).toEqual({ learning_preference: "corso di italiano" });
  });

  it("refuses to send a payload that breaks the contract, with paths and no values", () => {
    const broken = withStandard({ firstName: "Karim", country: "Marocco" });

    expect(() => buildKubriPayload(broken)).toThrow(KubriContractError);
    try {
      buildKubriPayload(broken);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(KubriContractError);
      expect((error as KubriContractError).paths).toEqual(["data.country"]);
      expect((error as Error).message).not.toContain("Marocco");
    }
  });
});
