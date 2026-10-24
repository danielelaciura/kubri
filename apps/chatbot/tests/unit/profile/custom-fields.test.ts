import { describe, expect, it } from "vitest";
import { CustomFieldDefinitionSchema, toFieldDefinition } from "../../../src/profile/custom-fields";

const base = {
  key: "vat_openness",
  type: "enum",
  options: ["si", "no", "da_valutare"],
  label: { it: "Disponibilità ad aprire P.IVA" },
  description: "Se il candidato è disposto ad aprire una partita IVA.",
};

describe("CustomFieldDefinitionSchema", () => {
  it("accepts a valid enum field", () => {
    expect(CustomFieldDefinitionSchema.safeParse(base).success).toBe(true);
  });

  it("requires options for enum fields", () => {
    const { options: _omit, ...withoutOptions } = base;
    const result = CustomFieldDefinitionSchema.safeParse(withoutOptions);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["options"]);
  });

  it("rejects options on non-enum fields", () => {
    const result = CustomFieldDefinitionSchema.safeParse({ ...base, type: "bool" });
    expect(result.success).toBe(false);
  });

  it("requires snake_case keys", () => {
    expect(CustomFieldDefinitionSchema.safeParse({ ...base, key: "VatOpenness" }).success).toBe(
      false,
    );
  });
});

describe("toFieldDefinition", () => {
  it("prefixes the key with custom.", () => {
    const def = toFieldDefinition(CustomFieldDefinitionSchema.parse(base));
    expect(def).toEqual({
      key: "custom.vat_openness",
      type: "enum",
      options: ["si", "no", "da_valutare"],
      description: "Se il candidato è disposto ad aprire una partita IVA.",
    });
  });
});
