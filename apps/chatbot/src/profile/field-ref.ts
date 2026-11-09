import {
  CUSTOM_FIELD_PREFIX,
  toFieldDefinition,
  type CustomFieldDefinition,
} from "./custom-fields";
import type { FieldDefinition } from "./field-definition";
import { getStandardField } from "./standard-fields";

/** Resolves "firstName" or "custom.<key>" against the standard registry and the campaign. */
export function resolveField(
  ref: string,
  customFields: readonly CustomFieldDefinition[],
): FieldDefinition | undefined {
  if (!ref.startsWith(CUSTOM_FIELD_PREFIX)) return getStandardField(ref);
  const key = ref.slice(CUSTOM_FIELD_PREFIX.length);
  const custom = customFields.find((field) => field.key === key);
  return custom ? toFieldDefinition(custom) : undefined;
}
