import { describe, it, expect } from "vitest";
import { normalizeJobName, planJobNameRenames } from "@/lib/jobs/normalize-name";

describe("normalizeJobName", () => {
  it.each([
    ["MAGAZZINIERE CARRELLISTA", "Magazziniere carrellista"],
    ["Addetto Alle Pulizie", "Addetto alle pulizie"],
    ["Operatore OSS Milano", "Operatore OSS milano"],
    ["operatore HACCP", "Operatore HACCP"],
    ["OPERATORE OSS", "Operatore oss"],
    ["Addetto A Magazzino", "Addetto a magazzino"],
    ["Operatore OSS/ASA", "Operatore OSS/ASA"],
    ["Commerciale B2B", "Commerciale B2B"],
    ["ADDETTO ALLA CUCINA È", "Addetto alla cucina è"],
    ["  addetto    pulizie  ", "Addetto pulizie"],
    ["HACCP Addetto", "HACCP addetto"],
    ["già normalizzato", "Già normalizzato"],
  ])("%j -> %j", (input, expected) => {
    expect(normalizeJobName(input)).toBe(expected);
  });

  it("is idempotent", () => {
    for (const s of ["MAGAZZINIERE", "Operatore OSS Milano", "OSS", "addetto A b C", "Èlite Staff"]) {
      const once = normalizeJobName(s);
      expect(normalizeJobName(once)).toBe(once);
    }
  });

  it("leaves a string without letters untouched apart from whitespace", () => {
    expect(normalizeJobName(" 123  45 ")).toBe("123 45");
  });
});

describe("planJobNameRenames", () => {
  it("renames rows whose normalized name differs and counts unchanged ones", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o1", name: "Cuoco" },
    ]);
    expect(plan.renames).toEqual([
      { id: "a", organizationId: "o1", from: "MAGAZZINIERE", to: "Magazziniere" },
    ]);
    expect(plan.collisions).toEqual([]);
    expect(plan.unchanged).toBe(1);
  });

  it("flags a collision with an already-normalized JD of the same org", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o1", name: "Magazziniere" },
    ]);
    expect(plan.renames).toEqual([]);
    expect(plan.collisions).toEqual([
      { id: "a", organizationId: "o1", from: "MAGAZZINIERE", to: "Magazziniere" },
    ]);
    expect(plan.unchanged).toBe(1);
  });

  it("flags every member when two non-normalized names collide", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o1", name: "magazziniere" },
    ]);
    expect(plan.renames).toEqual([]);
    expect(plan.collisions.map((c) => c.id).sort()).toEqual(["a", "b"]);
  });

  it("does not treat the same name in different orgs as a collision", () => {
    const plan = planJobNameRenames([
      { id: "a", organizationId: "o1", name: "MAGAZZINIERE" },
      { id: "b", organizationId: "o2", name: "MAGAZZINIERE" },
    ]);
    expect(plan.renames).toHaveLength(2);
    expect(plan.collisions).toEqual([]);
  });
});
