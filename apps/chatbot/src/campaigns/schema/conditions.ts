import { z } from "zod";

const ScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
export type Scalar = z.infer<typeof ScalarSchema>;

export type FieldCondition =
  | { field: string; eq: Scalar }
  | { field: string; neq: Scalar }
  | { field: string; in: Scalar[] }
  | { field: string; notIn: Scalar[] }
  | { field: string; exists: true }
  | { field: string; notExists: true }
  | { field: string; gt: number }
  | { field: string; lt: number };

export type Condition =
  | FieldCondition
  | { step: string; outcome: string }
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition };

const field = z.string().min(1);

// Conditions are data, never code (spec §5.5).
export const ConditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.strictObject({ field, eq: ScalarSchema }),
    z.strictObject({ field, neq: ScalarSchema }),
    z.strictObject({ field, in: z.array(ScalarSchema).min(1) }),
    z.strictObject({ field, notIn: z.array(ScalarSchema).min(1) }),
    z.strictObject({ field, exists: z.literal(true) }),
    z.strictObject({ field, notExists: z.literal(true) }),
    z.strictObject({ field, gt: z.number() }),
    z.strictObject({ field, lt: z.number() }),
    z.strictObject({ step: z.string().min(1), outcome: z.string().min(1) }),
    z.strictObject({ all: z.array(ConditionSchema).min(1) }),
    z.strictObject({ any: z.array(ConditionSchema).min(1) }),
    z.strictObject({ not: ConditionSchema }),
  ]),
);
