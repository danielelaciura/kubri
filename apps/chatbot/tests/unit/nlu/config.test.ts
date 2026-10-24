import { describe, expect, it } from "vitest";
import { parseNluConfig, requireMistralKey } from "../../../src/nlu/config";

describe("parseNluConfig", () => {
  it("has defaults for everything but the key, and ignores other variables", () => {
    expect(parseNluConfig({ DATABASE_URL: "postgres://x", PATH: "/bin" })).toEqual({
      mistralApiKey: undefined,
      models: {
        interpret: "mistral-small-latest",
        translate: "mistral-small-latest",
        fallback: "mistral-medium-latest",
      },
      timeoutMs: 15_000,
      historyMessages: 3,
      prices: {},
    });
  });

  it("reads every variable", () => {
    const config = parseNluConfig({
      MISTRAL_API_KEY: "k-123",
      NLU_INTERPRET_MODEL: "m-interpret",
      NLU_TRANSLATE_MODEL: "m-translate",
      NLU_FALLBACK_MODEL: "m-fallback",
      NLU_TIMEOUT_MS: "8000",
      NLU_HISTORY_MESSAGES: "0",
      NLU_PRICES: '{"m-interpret":{"inputPerMTok":0.1,"outputPerMTok":0.3}}',
    });

    expect(config).toEqual({
      mistralApiKey: "k-123",
      models: { interpret: "m-interpret", translate: "m-translate", fallback: "m-fallback" },
      timeoutMs: 8000,
      historyMessages: 0,
      prices: { "m-interpret": { inputPerMTok: 0.1, outputPerMTok: 0.3 } },
    });
  });

  it("treats an empty variable as unset (KEY= in .env)", () => {
    expect(parseNluConfig({ MISTRAL_API_KEY: "", NLU_TIMEOUT_MS: " " }).mistralApiKey).toBe(
      undefined,
    );
  });

  it("explains invalid values without echoing them", () => {
    expect(() => parseNluConfig({ NLU_TIMEOUT_MS: "soon" })).toThrow(/NLU_TIMEOUT_MS/);
    expect(() => parseNluConfig({ NLU_TIMEOUT_MS: "soon" })).not.toThrow(/soon/);
    expect(() => parseNluConfig({ NLU_HISTORY_MESSAGES: "50" })).toThrow(/NLU_HISTORY_MESSAGES/);
    expect(() => parseNluConfig({ NLU_PRICES: "{nope" })).toThrow(
      /NLU_PRICES: must be a JSON object/,
    );
  });
});

describe("requireMistralKey", () => {
  it("returns the key, or says how to do without it", () => {
    expect(requireMistralKey(parseNluConfig({ MISTRAL_API_KEY: "k" }))).toBe("k");
    expect(() => requireMistralKey(parseNluConfig({}))).toThrow(/MISTRAL_API_KEY is not set/);
  });
});
