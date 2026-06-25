import { z } from "zod/v4";
import { assessmentAnswersSchema } from "./assessment/schema";

export * from "./assessment/types";
export * from "./assessment/registry";
export * from "./assessment/schema";
export * from "./assessment/mapping";

/** Contact details collected when the user joins the Kubri community. */
export const assessmentContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Digits with an optional leading "+", 8–15 long (loose E.164).
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
  email: z.string().email().optional(),
  privacyAccepted: z.literal(true),
});
export type AssessmentContact = z.infer<typeof assessmentContactSchema>;

/** Payload the assessment app POSTs to the dashboard webhook on "join". */
export const assessmentSubmissionSchema = z.object({
  contact: assessmentContactSchema,
  assessment: assessmentAnswersSchema,
});
export type AssessmentSubmission = z.infer<typeof assessmentSubmissionSchema>;
