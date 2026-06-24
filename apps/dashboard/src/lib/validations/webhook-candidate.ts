import { z } from "zod/v4";

export const makeCandidateWebhookSchema = z.object({
  key: z.string().min(1),
  externalKey: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export type MakeCandidateWebhookPayload = z.infer<
  typeof makeCandidateWebhookSchema
>;
