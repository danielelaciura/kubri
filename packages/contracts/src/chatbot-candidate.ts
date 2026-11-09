import { z } from "zod/v4";

/**
 * Contract of `POST /api/webhooks/chatbot/candidate`: the Kubri chatbot sends the candidate's
 * full, current profile; the dashboard validates it with the same schema. One definition and one
 * example, used by the tests of both apps (chatbot spec §12.1 and §14, D122).
 */

/** `source_organization` of every chatbot payload. */
export const CHATBOT_SOURCE = "kubri-chatbot";
/** The only channel the chatbot speaks today. */
export const CHATBOT_CHANNEL = "whatsapp";

export const CHATBOT_INTERVIEW_STATUSES = ["in_progress", "completed", "stopped"] as const;
export type ChatbotInterviewStatus = (typeof CHATBOT_INTERVIEW_STATUSES)[number];

const text = z.string().trim().min(1);
const textList = z.array(text);
const languageCode = z.string().regex(/^[a-z]{2}$/);

/**
 * The candidate profile, with the snake_case keys of Make's payload so that `rawPayload` reads
 * the same. Strict: an unknown key is a contract error, not something to ignore. No coordinates
 * (the dashboard geocodes) and no CV link (the CV stays in the chatbot).
 */
export const chatbotCandidateDataSchema = z.strictObject({
  source_organization: z.literal(CHATBOT_SOURCE),
  channel: z.literal(CHATBOT_CHANNEL),
  interview_status: z.enum(CHATBOT_INTERVIEW_STATUSES),
  campaign_version: z.number().int().positive(),
  /** When the profile last changed, with its offset: the dashboard drops older sends. */
  last_updated: z.iso.datetime({ offset: true }),
  /** Outcome of the optional `kubri_global` consent. */
  is_kubri_privacy_accepted: z.boolean(),
  /** E.164. */
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/),
  interview_language: languageCode.optional(),

  first_name: text.optional(),
  last_name: text.optional(),
  /** dd/mm/yyyy. */
  birthday: z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/).optional(),
  /** ISO 3166-1 alpha-2. */
  country: z.string().regex(/^[A-Z]{2}$/).optional(),
  address: text.optional(),
  location: text.optional(),
  email: z.email().optional(),

  working_permit: z.boolean().optional(),
  transport: text.optional(),
  driving_license: z.boolean().optional(),
  driving_license_types: textList.optional(),

  education_and_training: textList.optional(),
  work_experience: textList.optional(),
  skills_and_competences: textList.optional(),

  language: languageCode.optional(),
  additional_languages: textList.optional(),
  italian_level: text.optional(),

  job_preferences: z
    .strictObject({
      preferred_job: text.optional(),
      part_time_preference: z.boolean().optional(),
      preferred_location: text.optional(),
      constraints: text.optional(),
      has_desired_job_experience: text.optional(),
    })
    .optional(),
  learning_preferences: z
    .strictObject({
      is_interested: z.boolean().optional(),
      learning_preference: text.optional(),
    })
    .optional(),
  /** The campaign's custom fields, by key. Kept in `rawPayload` only. */
  custom: z.record(z.string(), z.unknown()).optional(),
});
export type ChatbotCandidateData = z.infer<typeof chatbotCandidateDataSchema>;

export const chatbotCandidateWebhookSchema = z.object({
  /** `<Contact.id>:<Campaign.id>`: stable per candidate and campaign, no personal data. */
  key: z.string().min(1).max(200),
  /** The pool's external key. */
  externalKey: z.string().min(1).max(200),
  data: chatbotCandidateDataSchema,
});
export type ChatbotCandidateWebhook = z.infer<typeof chatbotCandidateWebhookSchema>;

/**
 * A complete payload with invented data. The chatbot's mapping must produce it and the
 * dashboard's tests read it. No `as const`: readonly tuples would not type-check as arrays.
 */
export const CHATBOT_CANDIDATE_PAYLOAD_EXAMPLE = {
  key: "7b0f6c2e-1d0a-4a8e-9d57-3f1c2a9b4e10:2c9f5d8a-6b1e-4c37-8a52-9e0d7f3b1a64",
  externalKey: "global",
  data: {
    source_organization: CHATBOT_SOURCE,
    channel: CHATBOT_CHANNEL,
    interview_status: "completed",
    campaign_version: 3,
    interview_language: "ar",
    last_updated: "2026-10-24T10:30:00.000Z",
    is_kubri_privacy_accepted: true,
    first_name: "Karim",
    last_name: "Benali",
    birthday: "12/05/1990",
    country: "MA",
    address: "Via Garibaldi 12",
    location: "Bologna",
    phone: "+393334445566",
    email: "karim.benali@example.com",
    working_permit: true,
    transport: "bicicletta",
    driving_license: true,
    driving_license_types: ["B"],
    education_and_training: ["2006 - 2010 Liceo Ibn Rushd (Marocco): Diploma"],
    work_experience: ["2018 - 2020 Bologna: Magazziniere"],
    skills_and_competences: ["uso del muletto", "puntualità"],
    language: "ar",
    additional_languages: ["francese (intermedio)"],
    italian_level: "intermedio",
    job_preferences: {
      preferred_job: "magazziniere",
      part_time_preference: false,
      preferred_location: "Bologna",
      constraints: "non lavoro la domenica",
      has_desired_job_experience: "due anni in magazzino",
    },
    learning_preferences: { is_interested: true, learning_preference: "corso per il muletto" },
    custom: { night_shifts: true },
  },
} satisfies ChatbotCandidateWebhook;
