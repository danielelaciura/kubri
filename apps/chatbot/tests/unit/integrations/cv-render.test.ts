import { describe, expect, it } from "vitest";
import { buildCvLayout } from "../../../src/integrations/cv/layout";
import { renderCv, toWinAnsi } from "../../../src/integrations/cv/render";

describe("toWinAnsi (D127)", () => {
  it("keeps Latin text and accents and replaces what the standard fonts cannot draw", () => {
    expect(toWinAnsi("Perché è già così – € 5")).toBe("Perché è già così – € 5");
    expect(toWinAnsi("كريم")).toBe("????");
    expect(toWinAnsi("a\u0000b")).toBe("ab");
  });
});

describe("renderCv", () => {
  it("produces a PDF", async () => {
    const bytes = await renderCv(
      buildCvLayout(
        { firstName: "Karim", lastName: "Benali", workExperience: ["2018 - 2020: Magazziniere"] },
        "+39333",
      ),
    );

    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(bytes.byteLength).toBeGreaterThan(500);
  });

  it("does not break on non-Latin names or on a long document", async () => {
    const long = Array.from(
      { length: 80 },
      (_, i) =>
        `2010 - 2011 Città ${i}: lavoro con molte parole che vanno a capo ${"x".repeat(60)}`,
    );

    const bytes = await renderCv(buildCvLayout({ firstName: "كريم", workExperience: long }, "+39"));

    expect(Buffer.from(bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
