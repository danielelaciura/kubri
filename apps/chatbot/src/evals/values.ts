import { normalizeText } from "../engine/normalize-text";
import type { FieldDefinition } from "../profile/field-definition";
import { structuredListsMatch } from "./structured";

/** Compared by parts (D94): the same wording can be written many ways. */
const STRUCTURED_FIELDS: ReadonlySet<string> = new Set(["workExperience", "educationAndTraining"]);

const NUMBER_TOLERANCE = 1e-9;

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
    ? value
    : undefined;
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  const left = a.map(normalizeText).sort();
  const right = b.map(normalizeText).sort();
  return left.length === right.length && left.every((item, i) => item === right[i]);
}

/** D94: deterministic, by field type. `def` undefined = a field nobody defined. */
export function valuesMatch(
  def: FieldDefinition | undefined,
  expected: unknown,
  actual: unknown,
): boolean {
  if (!def) return Object.is(expected, actual);
  switch (def.type) {
    case "bool":
    case "enum":
    case "date":
      return Object.is(expected, actual);
    case "number":
      return (
        typeof expected === "number" &&
        typeof actual === "number" &&
        Math.abs(expected - actual) < NUMBER_TOLERANCE
      );
    case "text":
      if (typeof expected !== "string" || typeof actual !== "string") return false;
      return def.format ? expected === actual : normalizeText(expected) === normalizeText(actual);
    case "list": {
      const want = strings(expected);
      const got = strings(actual);
      if (!want || !got) return false;
      return STRUCTURED_FIELDS.has(def.key) ? structuredListsMatch(want, got) : sameSet(want, got);
    }
  }
}
