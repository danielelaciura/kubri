import { z } from "zod/v4";

export const listNameSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(1, "Il nome della lista non può essere vuoto")
      .max(80, "Il nome della lista è troppo lungo"),
  );

export const createListSchema = z.object({
  name: listNameSchema,
});

export const renameListSchema = z.object({
  listId: z.string().uuid(),
  name: listNameSchema,
});

export const listMembershipSchema = z.object({
  listId: z.string().uuid(),
  candidateId: z.string().uuid(),
});
