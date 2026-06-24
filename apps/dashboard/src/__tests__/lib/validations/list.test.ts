import { describe, it, expect } from "vitest";
import { listNameSchema } from "@/lib/validations/list";

describe("listNameSchema", () => {
  it("trims and accepts a valid name", () => {
    const r = listNameSchema.parse("  Camerieri  ");
    expect(r).toBe("Camerieri");
  });

  it("rejects an empty name", () => {
    const r = listNameSchema.safeParse("   ");
    expect(r.success).toBe(false);
  });

  it("rejects a name longer than 80 chars", () => {
    const r = listNameSchema.safeParse("a".repeat(81));
    expect(r.success).toBe(false);
  });
});
