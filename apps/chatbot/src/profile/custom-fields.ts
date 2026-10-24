import { z } from "zod";
import { LocalizedTextSchema } from "../i18n/localized-text";
import type { FieldDefinition } from "./field-definition";

export const CUSTOM_FIELD_PREFIX = "custom.";

export const CustomFieldDefinitionSchema = z
  .strictObject({
    key: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case key"),
    type: z.enum(["text", "bool", "number", "date", "enum", "list"]),
    options: z.array(z.string().trim().min(1)).min(1).optional(),
    label: LocalizedTextSchema,
    description: z.string().trim().min(1),
    /** Health, family, immigration status…: the value never reaches the LLM. Absent = false. */
    sensitive: z.boolean().optional(),
  })
  .superRefine((field, ctx) => {
    if (field.type === "enum" && !field.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "enum fields require options" });
    }
    if (field.type !== "enum" && field.options) {
      ctx.addIssue({ code: "custom", path: ["options"], message: "only enum fields take options" });
    }
  });

export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

export function toFieldDefinition(field: CustomFieldDefinition): FieldDefinition {
  return {
    key: `${CUSTOM_FIELD_PREFIX}${field.key}`,
    type: field.type,
    description: field.description,
    ...(field.options ? { options: field.options } : {}),
    ...(field.sensitive === true ? { sensitive: true as const } : {}),
  };
}
