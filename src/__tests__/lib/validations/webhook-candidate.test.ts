import { describe, it, expect } from "vitest";
import { makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";

describe("makeCandidateWebhookSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc123",
      externalKey: "global",
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts a rich data object", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      externalKey: "global",
      data: {
        first_name: "Mario",
        last_name: "Rossi",
        education_and_training: ["x"],
        job_preferences: { desired_job: "magazziniere" },
        interview_complete: true,
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects when key is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      externalKey: "global",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when key is empty string", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "",
      externalKey: "global",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when externalKey is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when externalKey is empty string", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      externalKey: "",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when data is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      externalKey: "global",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when data is not an object", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      externalKey: "global",
      data: "oops",
    });
    expect(result.success).toBe(false);
  });
});
