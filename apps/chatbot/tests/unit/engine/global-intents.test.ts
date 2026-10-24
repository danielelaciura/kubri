import { describe, expect, it } from "vitest";
import { detectGlobalIntent, globalIntentOf } from "../../../src/engine/global-intents";
import { normalizeText } from "../../../src/engine/normalize-text";
import { interpretation } from "./helpers";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalizeText("  STOP!!  ")).toBe("stop");
  });

  it("keeps accented letters and combining marks", () => {
    expect(normalizeText("Supprimer mes DONNÉES.")).toBe("supprimer mes données");
    expect(normalizeText("বাংলা")).toBe("বাংলা");
  });
});

describe("detectGlobalIntent", () => {
  it.each([
    ["stop", "opt_out"],
    ["STOP!", "opt_out"],
    ["Basta.", "opt_out"],
    ["Cancella i miei dati", "delete_data"],
    ["delete my data", "delete_data"],
    ["احذف بياناتي", "delete_data"],
  ])("%j → %s", (text, intent) => {
    expect(detectGlobalIntent(text)).toBe(intent);
  });

  it.each(["basta così grazie", "stoppato", "non cancellare i miei dati", ""])(
    "ignores %j: the whole message must match",
    (text) => {
      expect(detectGlobalIntent(text)).toBeUndefined();
    },
  );
});

describe("globalIntentOf", () => {
  it("prefers the deterministic keyword over the interpretation", () => {
    expect(globalIntentOf("stop", interpretation({ intent: "answer" }))).toBe("opt_out");
  });

  it("uses the LLM intent when no keyword matches", () => {
    expect(globalIntentOf("voglio smettere", interpretation({ intent: "opt_out" }))).toBe(
      "opt_out",
    );
    expect(globalIntentOf("togliete tutto", interpretation({ intent: "delete_data" }))).toBe(
      "delete_data",
    );
  });

  it("works without an interpretation", () => {
    expect(globalIntentOf("cancellami", null)).toBe("delete_data");
    expect(globalIntentOf("Mario", null)).toBeUndefined();
  });
});
