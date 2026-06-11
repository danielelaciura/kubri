import { z } from "zod/v4";

export const languageSchema = z.object({
  language: z.enum(["it", "en"]),
});
