import { describe, expect, it } from "vitest";
import { targetsBotSchema } from "../../../src/config/database-url";

describe("targetsBotSchema", () => {
  it("is true only for schema=bot", () => {
    expect(targetsBotSchema("postgresql://u:p@localhost:5432/db?schema=bot")).toBe(true);
    expect(targetsBotSchema("postgresql://u:p@localhost:5432/db?sslmode=require&schema=bot")).toBe(
      true,
    );
  });

  it("is false for a missing or different schema", () => {
    expect(targetsBotSchema("postgresql://u:p@localhost:5432/db")).toBe(false);
    expect(targetsBotSchema("postgresql://u:p@localhost:5432/db?schema=public")).toBe(false);
  });

  it("is false for unparseable input", () => {
    expect(targetsBotSchema("not a url")).toBe(false);
  });
});
