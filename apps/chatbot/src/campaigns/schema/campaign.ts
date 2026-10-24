import { z } from "zod";
import { LanguageCodeSchema, LocalizedTextSchema } from "../../i18n/localized-text";
import { CustomFieldDefinitionSchema } from "../../profile/custom-fields";
import { HttpsUrlSchema, IdSchema, SlugSchema } from "./ids";
import { StepSchema } from "./steps";

// Spec §5.1. `version` is not part of the file: the import assigns it (plan 03).
export const CampaignDefinitionSchema = z.strictObject({
  campaign: SlugSchema,
  organization: SlugSchema,
  /** The pool key on the Kubri platform, sent with the webhook. */
  externalKey: z.string().trim().min(1),
  trigger: z.strictObject({
    sender: SlugSchema,
    keywords: z.array(z.string().trim().toLowerCase().min(2)).default([]),
    /** The campaign used on this sender when no keyword matches. */
    isDefault: z.boolean().default(false),
  }),
  defaultLanguage: LanguageCodeSchema.default("it"),
  dataController: z.strictObject({
    name: z.string().trim().min(1),
    privacyUrl: HttpsUrlSchema,
  }),
  onStop: z.strictObject({ data: z.enum(["delete", "keep"]) }).default({ data: "keep" }),
  customFields: z.array(CustomFieldDefinitionSchema).default([]),
  texts: z.record(IdSchema, LocalizedTextSchema).default({}),
  flow: z.array(StepSchema).min(1),
  afterCompletion: z
    .strictObject({
      allowEdits: z.boolean().default(true),
      allowCvRegeneration: z.boolean().default(false),
    })
    .default({ allowEdits: true, allowCvRegeneration: false }),
});

export type CampaignDefinition = z.infer<typeof CampaignDefinitionSchema>;
export type CampaignInput = z.input<typeof CampaignDefinitionSchema>;
