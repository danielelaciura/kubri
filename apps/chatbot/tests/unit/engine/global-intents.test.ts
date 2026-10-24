import { describe, expect, it } from "vitest";
import {
  detectGlobalIntent,
  globalIntentOf,
  isNoKeyword,
  isYesKeyword,
} from "../../../src/engine/global-intents";
import { normalizeText } from "../../../src/engine/normalize-text";
import { interpretation } from "./helpers";

describe("normalizeText", () => {
  it("lowercases, strips punctuation and collapses spaces", () => {
    expect(normalizeText("  STOP!!  ")).toBe("stop");
  });

  it("folds accents and keeps non-Latin letters", () => {
    expect(normalizeText("Supprimer mes DONNÉES.")).toBe("supprimer mes donnees");
    expect(normalizeText("বাংলা")).toBe("বাংলা");
  });

  it("folds Latin diacritics for lookup", () => {
    expect(normalizeText("Supprimer mes DONNÉES")).toBe(normalizeText("supprimer mes donnees"));
    expect(normalizeText("inglés")).toBe("ingles");
  });

  it("strips Arabic tashkeel and tatweel", () => {
    expect(normalizeText("توقّف")).toBe("توقف");
    expect(normalizeText("تـوقـف")).toBe("توقف");
  });

  it("keeps the combining marks of Indic scripts", () => {
    expect(normalizeText("बन्द")).toBe("बन्द");
    expect(normalizeText("বন্ধ")).toBe("বন্ধ");
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
    ["Ｓｔｏｐ", "opt_out"],
    ["STOP 🛑", "opt_out"],
    ["توقّف", "opt_out"],
    ["Стоп!", "opt_out"],
    ["بند", "opt_out"],
    ["বন্ধ", "opt_out"],
    ["opreste", "opt_out"],
    ["oprește", "opt_out"],
    ["parar", "opt_out"],
    ["no mas", "opt_out"],
    ["no más", "opt_out"],
    ["Supprimer mes données", "delete_data"],
    ["supprimer mes donnees", "delete_data"],
    ["borrar mis datos", "delete_data"],
    ["șterge datele mele", "delete_data"],
    ["sterge datele mele", "delete_data"],
    ["Arrêt", "opt_out"],
  ])("%j → %s", (text, intent) => {
    expect(detectGlobalIntent(text)).toBe(intent);
  });

  it.each([
    "basta così grazie",
    "stoppato",
    "non cancellare i miei dati",
    "ne supprimez pas mes données",
    "no borrar mis datos",
    "para",
    "",
  ])("ignores %j: the whole message must match", (text) => {
    expect(detectGlobalIntent(text)).toBeUndefined();
  });
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

describe("isYesKeyword", () => {
  it.each(["sì", "Si!", "YES", "ok", "confermo", "نعم"])("accepts %s", (text) => {
    expect(isYesKeyword(text)).toBe(true);
  });

  it.each(["no", "sì ma prima", "forse", ""])("rejects %s", (text) => {
    expect(isYesKeyword(text)).toBe(false);
  });
});

describe("isNoKeyword", () => {
  it.each(["no", "No!", "non", "nope", "nein", "не", "ні", "لا", "nu", "non merci", "no grazie"])(
    "accepts %s",
    (text) => {
      expect(isNoKeyword(text)).toBe(true);
    },
  );

  it.each(["sì", "no ma aspetta", "nome", ""])("rejects %s", (text) => {
    expect(isNoKeyword(text)).toBe(false);
  });
});
