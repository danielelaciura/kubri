import { describe, it, expect } from "vitest";
import {
  CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE,
  chatbotCandidateWebhookSchema,
  type ChatbotCandidateWebhook,
} from "@kubri/contracts";
import { normalizeChatbotCandidate } from "@/lib/chatbot/normalize";

const POOL = { id: "00000000-0000-0000-0000-000000000001", isGlobal: true, globalSharing: "WEBHOOK" as const };

/** The example as the route sees it: parsed by the contract schema. */
function example(): ChatbotCandidateWebhook {
  return chatbotCandidateWebhookSchema.parse(structuredClone(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE));
}

describe("normalizeChatbotCandidate", () => {
  it("maps every field of the contract example", () => {
    const geo = { latitude: 44.49, longitude: 11.34, location: "Bologna (BO)" };
    expect(normalizeChatbotCandidate(example(), POOL, geo)).toEqual({
      externalId: CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE.key,
      poolId: POOL.id,
      firstName: "Karim",
      lastName: "Benali",
      birthday: "12/05/1990",
      countryOfOrigin: "MA",
      address: "Via Garibaldi 12",
      location: "Bologna (BO)",
      latitude: 44.49,
      longitude: 11.34,
      phone: "+393334445566",
      email: "karim.benali@example.com",
      workingPermit: true,
      meanOfTransport: "bicicletta",
      drivingLicense: true,
      educationAndTraining: ["2006 - 2010 Liceo Ibn Rushd (Marocco): Diploma"],
      workExperience: ["2018 - 2020 Bologna: Magazziniere"],
      skillsAndCompetences: ["uso del muletto", "puntualità"],
      language: "ar",
      additionalLanguages: ["francese (intermedio)"],
      italianLevel: "intermedio",
      desiredJob: "magazziniere",
      partTimePreference: false,
      preferredLocation: "Bologna",
      jobConstraints: "non lavoro la domenica",
      hasDesiredJobExperience: "due anni in magazzino",
      learningPreference: "corso per il muletto",
      interviewLanguage: "ar",
      sourceOrganization: "kubri-chatbot",
      channel: "whatsapp",
      sharedWithGlobal: true,
      rawPayload: example(),
      sourceUpdatedAt: new Date("2026-10-24T10:30:00.000Z"),
    });
  });

  it("keeps the declared location and null coordinates without a geocoding result", () => {
    const out = normalizeChatbotCandidate(example(), POOL, null);
    expect(out).toMatchObject({ location: "Bologna", latitude: null, longitude: null });
  });

  it("writes null and empty lists for the fields the chatbot did not send", () => {
    const minimal = chatbotCandidateWebhookSchema.parse({
      key: "c:k",
      externalKey: "global",
      data: {
        source_organization: "kubri-chatbot",
        channel: "whatsapp",
        interview_status: "in_progress",
        campaign_version: 1,
        last_updated: "2026-10-24T12:30:00+02:00",
        is_kubri_privacy_accepted: false,
        phone: "+393334445566",
      },
    });
    const out = normalizeChatbotCandidate(minimal, POOL, null);
    expect(out).toMatchObject({
      firstName: null, address: null, location: null, email: null, drivingLicense: null,
      workExperience: [], additionalLanguages: [], desiredJob: null, learningPreference: null,
      interviewLanguage: null, channel: "whatsapp", sharedWithGlobal: false,
      sourceUpdatedAt: new Date("2026-10-24T10:30:00.000Z"),
    });
  });

  it("lowercases the email", () => {
    const payload = example();
    payload.data.email = "Karim.Benali@Example.com";
    expect(normalizeChatbotCandidate(payload, POOL, null).email).toBe("karim.benali@example.com");
  });

  it("applies the pool's global sharing rule like the Make webhook", () => {
    const consenting = example();
    const refusing = example();
    refusing.data.is_kubri_privacy_accepted = false;
    const pool = (globalSharing: "WEBHOOK" | "ALWAYS" | "NEVER") => ({ ...POOL, isGlobal: false, globalSharing });

    expect(normalizeChatbotCandidate(refusing, pool("ALWAYS"), null).sharedWithGlobal).toBe(true);
    expect(normalizeChatbotCandidate(consenting, pool("NEVER"), null).sharedWithGlobal).toBe(false);
    expect(normalizeChatbotCandidate(consenting, pool("WEBHOOK"), null).sharedWithGlobal).toBe(true);
    expect(normalizeChatbotCandidate(refusing, pool("WEBHOOK"), null).sharedWithGlobal).toBe(false);
  });
});
