import { describe, expect, it } from "vitest";
import {
  CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE,
  CHATBOT_CHANNEL,
  CHATBOT_SOURCE,
  chatbotCandidateDataSchema,
  chatbotCandidateWebhookSchema,
} from "./index";

const example = () =>
  JSON.parse(JSON.stringify(CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE)) as {
    key: string;
    externalKey: string;
    data: Record<string, unknown>;
  };

function withData(change: Record<string, unknown>) {
  const payload = example();
  payload.data = { ...payload.data, ...change };
  return payload;
}

describe("chatbot candidate webhook contract", () => {
  it("the example is a valid payload", () => {
    expect(chatbotCandidateWebhookSchema.safeParse(example()).success).toBe(true);
    expect(CHATBOT_SOURCE).toBe("kubri-chatbot");
    expect(CHATBOT_CHANNEL).toBe("whatsapp");
  });

  it("refuses an empty key or external key", () => {
    expect(chatbotCandidateWebhookSchema.safeParse({ ...example(), key: "" }).success).toBe(false);
    expect(chatbotCandidateWebhookSchema.safeParse({ ...example(), externalKey: "" }).success).toBe(
      false,
    );
  });

  it("refuses an unknown key in data", () => {
    expect(chatbotCandidateWebhookSchema.safeParse(withData({ future_field: 1 })).success).toBe(
      false,
    );
  });

  it("refuses coordinates and a CV link: the dashboard geocodes, the CV stays in the chatbot", () => {
    expect(chatbotCandidateWebhookSchema.safeParse(withData({ lat: 45, lng: 9 })).success).toBe(
      false,
    );
    expect(
      chatbotCandidateWebhookSchema.safeParse(
        withData({ cv_link_pdf: "https://example.com/cv.pdf" }),
      ).success,
    ).toBe(false);
  });

  it("refuses an unknown key in the nested objects", () => {
    const old = withData({ learning_preferences: { preference: "muletto" } });
    expect(chatbotCandidateWebhookSchema.safeParse(old).success).toBe(false);
    const jp = withData({ job_preferences: { salary: 1 } });
    expect(chatbotCandidateWebhookSchema.safeParse(jp).success).toBe(false);
  });

  it.each([
    ["a different channel", { channel: "telegram" }],
    ["a different source organization", { source_organization: "APL Milano" }],
    ["a last_updated without offset", { last_updated: "2026-10-24T10:30:00" }],
    ["a last_updated that is not a datetime", { last_updated: "24/10/2026" }],
    ["an unknown interview status", { interview_status: "done" }],
    ["an ISO birthday", { birthday: "1990-05-12" }],
    ["a lowercase country", { country: "ma" }],
    ["a phone without +", { phone: "393334445566" }],
    ["a non-boolean consent", { is_kubri_privacy_accepted: "yes" }],
    ["a bad language code", { language: "Arabic" }],
    ["an empty list item", { work_experience: [""] }],
    ["an empty licence type", { driving_license_types: [" "] }],
  ])("refuses %s", (_name, change) => {
    expect(chatbotCandidateWebhookSchema.safeParse(withData(change)).success).toBe(false);
  });

  it("accepts a last_updated with an explicit offset", () => {
    const payload = withData({ last_updated: "2026-10-24T12:30:00+02:00" });
    expect(chatbotCandidateWebhookSchema.safeParse(payload).success).toBe(true);
  });

  it("accepts every interview status", () => {
    for (const status of ["in_progress", "completed", "stopped"]) {
      const payload = withData({ interview_status: status });
      expect(chatbotCandidateWebhookSchema.safeParse(payload).success).toBe(true);
    }
  });

  it("needs only the always-present fields", () => {
    const minimal = {
      key: "c:k",
      externalKey: "global",
      data: {
        source_organization: CHATBOT_SOURCE,
        channel: CHATBOT_CHANNEL,
        interview_status: "in_progress",
        campaign_version: 1,
        last_updated: "2026-10-24T10:30:00.000Z",
        is_kubri_privacy_accepted: false,
        phone: "+393334445566",
      },
    };

    expect(chatbotCandidateWebhookSchema.safeParse(minimal).success).toBe(true);
    for (const field of Object.keys(minimal.data)) {
      const rest: Record<string, unknown> = { ...minimal.data };
      delete rest[field];
      const payload = { ...minimal, data: rest };
      expect(chatbotCandidateWebhookSchema.safeParse(payload).success, field).toBe(false);
    }
  });

  it("exposes the data schema on its own", () => {
    expect(chatbotCandidateDataSchema.safeParse(example().data).success).toBe(true);
  });
});
