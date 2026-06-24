import { z } from "zod/v4";

const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const poolCreateSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z
    .string()
    .regex(slugRegex, "Solo lettere minuscole, numeri e trattini")
    .min(1)
    .max(100),
  externalKey: z.string().min(1).max(255).optional().nullable(),
});

export const poolUpdateSchema = poolCreateSchema.partial();

export type PoolCreateInput = z.infer<typeof poolCreateSchema>;
export type PoolUpdateInput = z.infer<typeof poolUpdateSchema>;
