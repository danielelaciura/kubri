import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import type { TextRef } from "../../../src/engine/text-ref";
import { FakeTranslator } from "../../../src/i18n/fake-translator";
import { createTextResolver, outputLanguage } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import type { Translator } from "../../../src/i18n/translator";
import { campaign } from "../engine/helpers";

function resolver(translator: Translator = new FakeTranslator()) {
  return createTextResolver({ translator, cache: new MemoryTranslationCache() });
}

const sys = (key: string, params?: Record<string, unknown>): TextRef =>
  ({ kind: "system", key, ...(params ? { params } : {}) }) as TextRef;

/** The minimal campaign with a consent text that uses the data controller's name. */
function withConsent(text: Record<string, string>): CampaignDefinition {
  return campaign((input) => {
    input.flow[2] = {
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      textVersion: "2026-10",
      text,
      link: "https://example.com/privacy",
    };
  });
}

const consentRef = (c: CampaignDefinition): TextRef => {
  const step = c.flow[2];
  if (step?.type !== "consent" || "ref" in step.text) throw new Error("fixture");
  return {
    kind: "step",
    path: "privacy",
    text: step.text,
    params: { "dataController.name": "ACME S.r.l." },
  };
};

describe("outputLanguage", () => {
  it("is the session language, or the campaign default before the choice (D77)", () => {
    expect(outputLanguage("ar", campaign())).toBe("ar");
    expect(outputLanguage(null, campaign())).toBe("it");
  });
});

describe("system texts", () => {
  it("resolves a plain text in Italian", async () => {
    const result = await resolver().resolve(sys("system.stopped"), {
      campaign: campaign(),
      language: "it",
    });

    expect(result).toEqual({
      text: "Va bene, l'intervista finisce qui. Grazie per il tuo tempo.",
      language: "it",
      source: "reference",
      isCurated: true,
      critical: false,
      missingParams: [],
    });
  });

  it("fills the progress numbers", async () => {
    const { text } = await resolver().resolve(sys("system.progress", { current: 2, total: 5 }), {
      campaign: campaign(),
      language: "it",
    });

    expect(text).toBe("Sezione 2 di 5");
  });

  it.each([
    [{ field: "firstName", value: "Mario" }, "Per «nome» ho capito: Mario."],
    [{ field: "custom.night_shifts", value: true }, "Per «Turni notturni» ho capito: sì."],
    [{ field: "drivingLicense", value: false }, "Per «patente di guida» ho capito: no."],
    [{ field: "birthday", value: "1990-05-12" }, "Per «data di nascita» ho capito: 12/05/1990."],
    [
      { field: "drivingLicenseTypes", value: ["B", "C"] },
      "Per «categorie di patente» ho capito: B, C.",
    ],
  ])("shows a readable field and value in confirm_value (%j)", async (params, expected) => {
    const { text } = await resolver().resolve(sys("system.confirm_value", params), {
      campaign: campaign(),
      language: "it",
    });

    expect(text).toBe(`${expected} È corretto? Rispondi sì o no.`);
  });

  it("shows an empty old value in confirm_edit", async () => {
    const { text } = await resolver().resolve(
      sys("system.confirm_edit", { field: "location", oldValue: null, newValue: "Bologna" }),
      { campaign: campaign(), language: "it" },
    );

    expect(text).toBe(
      "Vuoi cambiare «comune di residenza» da (nessun valore) a Bologna? Rispondi sì per confermare o no per lasciarlo com'è.",
    );
  });

  it("picks the post-completion variant", async () => {
    const { text } = await resolver().resolve(
      sys("system.post_completion_help", { allowEdits: false, allowCvRegeneration: true }),
      { campaign: campaign(), language: "it" },
    );

    expect(text).toBe("La tua intervista è completa. Se vuoi, puoi chiedermi di rifare il CV.");
  });

  it("translates templates and labels, never the candidate's values (D70)", async () => {
    const translator = new FakeTranslator();

    const result = await resolver(translator).resolve(
      sys("system.confirm_value", { field: "firstName", value: "Mariangela" }),
      { campaign: campaign(), language: "en" },
    );

    expect(result).toMatchObject({
      text: "[en] Per «[en] nome» ho capito: Mariangela. È corretto? Rispondi sì o no.",
      language: "en",
      source: "translated",
      isCurated: false,
    });
    expect(translator.requests.map((r) => [r.kind, r.text])).toEqual([
      ["system", "Per «{field}» ho capito: {value}. È corretto? Rispondi sì o no."],
      ["label", "nome"],
    ]);
    expect(JSON.stringify(translator.requests)).not.toContain("Mariangela");
  });

  it("keeps the welcome intact when a translator adds a placeholder to it", async () => {
    // The welcome already embeds an English line: a translator may rewrite it, but it can't
    // smuggle in a placeholder (D71) — the whole Italian text is sent instead.
    const welcome = await resolver().resolve(sys("system.welcome"), {
      campaign: campaign(),
      language: "it",
    });

    const result = await resolver({
      translate: () =>
        Promise.resolve({ text: "Hi {name}! Which language?", provider: "p", model: "m" }),
    }).resolve(sys("system.welcome"), { campaign: campaign(), language: "en" });

    expect(result).toMatchObject({
      text: welcome.text,
      language: "it",
      source: "fallback",
      missingParams: [],
    });
    expect(welcome.text).toContain("Hi! I'm Kubri's assistant.");
  });
});

describe("campaign and step texts", () => {
  it("resolves an entry of the campaign's texts", async () => {
    const { text } = await resolver().resolve(
      { kind: "campaign", key: "cv_explain" },
      { campaign: campaign(), language: "it" },
    );

    expect(text).toBe("Un CV è un documento che riassume le tue esperienze.");
  });

  it("uses a curated step translation", async () => {
    const translator = new FakeTranslator();

    const result = await resolver(translator).resolve(
      { kind: "step", path: "intro", text: { it: "Ciao!", en: "Hi!" } },
      { campaign: campaign(), language: "en" },
    );

    expect(result).toMatchObject({ text: "Hi!", source: "curated", isCurated: true });
    expect(translator.requests).toEqual([]);
  });

  it("reports placeholders with no parameter", async () => {
    const result = await resolver().resolve(
      { kind: "step", path: "intro", text: { it: "Ciao {name}" } },
      { campaign: campaign(), language: "it" },
    );

    expect(result).toMatchObject({ text: "Ciao {name}", missingParams: ["name"] });
  });

  it("sends generated texts as they are", async () => {
    expect(
      await resolver().resolve(
        { kind: "generated", text: "It's sunny!" },
        { campaign: campaign(), language: "en" },
      ),
    ).toEqual({
      text: "It's sunny!",
      language: "en",
      source: "generated",
      isCurated: false,
      critical: false,
      missingParams: [],
    });
  });
});

describe("consent texts (critical, D74)", () => {
  it("fills the data controller and marks the Italian text curated and critical", async () => {
    const c = withConsent({ it: "Titolare: {dataController.name}. Accetti?" });

    const result = await resolver().resolve(consentRef(c), { campaign: c, language: "it" });

    expect(result).toMatchObject({
      text: "Titolare: ACME S.r.l.. Accetti?",
      isCurated: true,
      critical: true,
    });
  });

  it("adds the official link under a machine translation", async () => {
    const c = withConsent({ it: "Titolare: {dataController.name}. Accetti?" });

    const result = await resolver().resolve(consentRef(c), { campaign: c, language: "en" });

    expect(result.isCurated).toBe(false);
    expect(result.critical).toBe(true);
    expect(result.text).toBe(
      "[en] Titolare: ACME S.r.l.. Accetti?\n\n[en] Questa è una traduzione automatica. Il testo ufficiale, in italiano, è qui: https://example.com/privacy",
    );
  });

  it("asks the translator for a faithful (critical) translation", async () => {
    const translator = new FakeTranslator();
    const c = withConsent({ it: "Accetti?" });

    await resolver(translator).resolve(consentRef(c), { campaign: c, language: "en" });

    expect(translator.requests[0]?.kind).toBe("critical");
  });

  it("adds no link under a curated translation", async () => {
    const c = withConsent({ it: "Accetti?", en: "Do you accept {dataController.name}?" });

    const result = await resolver().resolve(consentRef(c), { campaign: c, language: "en" });

    expect(result).toMatchObject({
      text: "Do you accept ACME S.r.l.?",
      isCurated: true,
      critical: true,
    });
  });

  it("sends the Italian official text when the translation fails", async () => {
    const c = withConsent({ it: "Accetti?" });

    const result = await resolver({ translate: () => Promise.reject(new Error("down")) }).resolve(
      consentRef(c),
      { campaign: c, language: "en" },
    );

    expect(result).toMatchObject({ text: "Accetti?", language: "it", isCurated: true });
  });

  it("recognizes a consent text given by reference", async () => {
    const c = campaign((input) => {
      input.texts = { ...input.texts, privacy_text: { it: "Accetti?" } };
      input.flow[2] = {
        id: "privacy",
        type: "consent",
        consentKey: "acme_privacy",
        textVersion: "2026-10",
        text: { ref: "privacy_text" },
      };
    });

    const result = await resolver().resolve(
      { kind: "campaign", key: "privacy_text" },
      { campaign: c, language: "en" },
    );

    expect(result.critical).toBe(true);
    // No link on the step: the data controller's privacy page.
    expect(result.text).toContain("https://example.com/privacy");
  });
});
