import { describe, it, expect } from "vitest";
import { makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";

describe("makeCandidateWebhookSchema", () => {
  it("accepts a minimal valid payload", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc123",
      makeDatastoreId: "ds_xyz",
      data: {},
    });
    expect(result.success).toBe(true);
  });

  it("accepts a rich data object", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      makeDatastoreId: "ds",
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
      makeDatastoreId: "ds",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when key is empty string", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "",
      makeDatastoreId: "ds",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when makeDatastoreId is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      data: {},
    });
    expect(result.success).toBe(false);
  });

  it("rejects when data is missing", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      makeDatastoreId: "ds",
    });
    expect(result.success).toBe(false);
  });

  it("rejects when data is not an object", () => {
    const result = makeCandidateWebhookSchema.safeParse({
      key: "abc",
      makeDatastoreId: "ds",
      data: "oops",
    });
    expect(result.success).toBe(false);
  });
});
