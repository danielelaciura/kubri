import { describe, expect, it } from "vitest";
import type { FieldDefinition } from "../../../src/profile/field-definition";
import { valueSchemaFor } from "../../../src/profile/field-value";

const field = (def: Partial<FieldDefinition> & Pick<FieldDefinition, "type">): FieldDefinition => ({
  key: "test",
  description: "test field",
  ...def,
});

function accepts(def: FieldDefinition, value: unknown): boolean {
  return valueSchemaFor(def).safeParse(value).success;
}

describe("valueSchemaFor", () => {
  it("text: trims and rejects empty strings", () => {
    expect(valueSchemaFor(field({ type: "text" })).parse("  Mario ")).toBe("Mario");
    expect(accepts(field({ type: "text" }), "  ")).toBe(false);
    expect(accepts(field({ type: "text" }), 12)).toBe(false);
  });

  it("bool: only real booleans", () => {
    expect(accepts(field({ type: "bool" }), true)).toBe(true);
    expect(accepts(field({ type: "bool" }), "true")).toBe(false);
  });

  it("number: finite numbers only", () => {
    expect(accepts(field({ type: "number" }), 45.4)).toBe(true);
    expect(accepts(field({ type: "number" }), Number.POSITIVE_INFINITY)).toBe(false);
    expect(accepts(field({ type: "number" }), "45")).toBe(false);
  });

  it("date: ISO calendar dates", () => {
    expect(accepts(field({ type: "date" }), "1990-04-21")).toBe(true);
    expect(accepts(field({ type: "date" }), "21/04/1990")).toBe(false);
    expect(accepts(field({ type: "date" }), "1990-02-31")).toBe(false);
  });

  it("enum: only declared options", () => {
    const def = field({ type: "enum", options: ["base", "avanzato"] });
    expect(accepts(def, "base")).toBe(true);
    expect(accepts(def, "intermedio")).toBe(false);
  });

  it("enum without options is a programming error", () => {
    expect(() => valueSchemaFor(field({ type: "enum" }))).toThrow(/options/);
  });

  it("list: non-empty array of non-empty strings", () => {
    expect(accepts(field({ type: "list" }), ["B", "C"])).toBe(true);
    expect(accepts(field({ type: "list" }), [])).toBe(false);
    expect(accepts(field({ type: "list" }), ["B", " "])).toBe(false);
  });

  it.each([
    ["email", "mario@example.com", "mario@"],
    ["e164", "+393331234567", "3331234567"],
    ["iso-country", "MA", "Marocco"],
    ["iso-language", "ar", "arabo"],
  ] as const)("text format %s", (format, valid, invalid) => {
    const def = field({ type: "text", format });
    expect(accepts(def, valid)).toBe(true);
    expect(accepts(def, invalid)).toBe(false);
  });
});
