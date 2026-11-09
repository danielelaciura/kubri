import { z } from "zod";

/** Step, question, option, consent and text ids. */
export const IdSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, "lowercase snake_case id");

/** Campaign, organization and sender slugs. */
export const SlugSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "kebab-case slug");

/** Only https: links are accepted (rejects javascript:, http:, ftp:, ...). */
export const HttpsUrlSchema = z
  .url()
  .refine((value) => URL.canParse(value) && new URL(value).protocol === "https:", {
    message: "must be an https: URL",
  });
