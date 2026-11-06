import { z } from "zod";

/**
 * The name of an environment variable / platform secret holding a credential, never the
 * credential itself (spec §10.1, §16.3). UPPER_SNAKE_CASE rules out pasted tokens.
 */
export const SecretRefSchema = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]{2,}$/, "must be the NAME of a secret (UPPER_SNAKE_CASE), not its value");

/** SenderNumber.providerConfig for provider "meta" (WhatsApp Cloud API): identifiers only. */
export const MetaProviderConfigSchema = z.strictObject({
  phoneNumberId: z.string().regex(/^\d+$/, "numeric Meta phone number id"),
  wabaId: z.string().regex(/^\d+$/, "numeric WhatsApp Business Account id"),
  accessTokenSecret: SecretRefSchema,
});

export type MetaProviderConfig = z.infer<typeof MetaProviderConfigSchema>;
