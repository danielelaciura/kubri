import { z } from "zod/v4";

/** Contact details collected when the user joins the Kubri community. */
export const assessmentContactSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Digits with an optional leading "+", 8–15 long (loose E.164).
  phone: z.string().regex(/^\+?[0-9]{8,15}$/),
});
export type AssessmentContact = z.infer<typeof assessmentContactSchema>;

/**
 * The structured assessment answers. The exact shape is defined by the
 * questionnaire (a later feature spec); until then it is an open record,
 * mirroring how the Make webhook accepts `data` as an opaque object.
 */
export const assessmentAnswersSchema = z.record(z.string(), z.unknown());
export type AssessmentAnswers = z.infer<typeof assessmentAnswersSchema>;

/** Payload the assessment app POSTs to the dashboard webhook on "join". */
export const assessmentSubmissionSchema = z.object({
  contact: assessmentContactSchema,
  assessment: assessmentAnswersSchema,
});
export type AssessmentSubmission = z.infer<typeof assessmentSubmissionSchema>;
