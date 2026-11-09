import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createTextResolver } from "../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../src/i18n/translation-cache";
import type { TranslationRequest } from "../../../src/i18n/translator";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { LlmError, type LlmRequest } from "../../../src/nlu/llm-provider";
import { TRANSLATE_SYSTEM_PROMPT } from "../../../src/nlu/prompts/translate-v1";
import { MemoryTraceSink, traceInput } from "../../../src/nlu/trace";
import { createLlmTranslator } from "../../../src/nlu/translate";
import { campaign } from "../engine/helpers";
import { taskOptions } from "./helpers";

const REQUEST: TranslationRequest = {
  text: "Accetti {dataController.name}?",
  sourceLanguage: "it",
  targetLanguage: "en",
  kind: "critical",
};

const InputSchema = z.object({ targetLanguage: z.string(), kind: z.string(), text: z.string() });

/** Answers "EN <Italian text>", placeholders untouched. */
const echo = (request: LlmRequest): string => {
  const { text } = InputSchema.parse(JSON.parse(request.messages[1]?.content ?? "{}"));
  return JSON.stringify({ text: `EN ${text}` });
};

describe("createLlmTranslator", () => {
  it("sends the template with the target language and kind, and returns the translation", async () => {
    const provider = new FakeLlmProvider([echo]);
    const traces = new MemoryTraceSink();

    const translation = await createLlmTranslator(taskOptions(provider, traces)).translate(REQUEST);

    expect(translation).toEqual({
      text: "EN Accetti {dataController.name}?",
      provider: "fake",
      model: "mistral-small-latest",
    });
    expect(provider.requests[0]?.messages[0]?.content).toBe(TRANSLATE_SYSTEM_PROMPT);
    expect(InputSchema.parse(JSON.parse(provider.requests[0]?.messages[1]?.content ?? ""))).toEqual(
      { targetLanguage: "en", kind: "critical", text: "Accetti {dataController.name}?" },
    );
    expect(provider.requests[0]).toMatchObject({ temperature: 0, responseFormat: "json" });
    expect(traces.records).toMatchObject([
      {
        task: "translate",
        promptVersion: "translate-v1",
        turnId: null,
        valid: true,
        repair: false,
      },
    ]);
    expect(traces.records[0]?.input).toEqual(traceInput(provider.requests[0]?.messages ?? []));
  });

  it("accepts a reply wrapped in a code fence", async () => {
    const provider = new FakeLlmProvider(['```json\n{"text":"Hello"}\n```']);

    expect((await createLlmTranslator(taskOptions(provider)).translate(REQUEST)).text).toBe(
      "Hello",
    );
  });

  it.each(["not json", '{"text":""}', '{"translation":"Hi"}', '{"text":"Hi","note":"x"}'])(
    "throws on the invalid output %j, without a repair call (D88)",
    async (reply) => {
      const provider = new FakeLlmProvider([reply]);
      const traces = new MemoryTraceSink();

      await expect(
        createLlmTranslator(taskOptions(provider, traces)).translate(REQUEST),
      ).rejects.toThrow(/translation to en unavailable/);
      expect(provider.requests).toHaveLength(1);
      expect(traces.records.map((r) => r.valid)).toEqual([false]);
    },
  );

  it("throws when the LLM is unavailable, after retries and fallback", async () => {
    const down = () => new LlmError("server", "Mistral HTTP 503", 503);
    const provider = new FakeLlmProvider([down(), down(), down(), down()]);
    const traces = new MemoryTraceSink();

    await expect(
      createLlmTranslator(taskOptions(provider, traces)).translate(REQUEST),
    ).rejects.toThrow(/translation to en unavailable/);
    expect(traces.records.map((r) => r.attempt)).toEqual(["primary", "retry", "retry", "fallback"]);
  });

  it("uses the translate model", async () => {
    const provider = new FakeLlmProvider([echo]);
    const options = taskOptions(provider);
    const config = {
      ...options.config,
      models: { ...options.config.models, translate: "t-model" },
    };

    await createLlmTranslator({ ...options, config }).translate(REQUEST);

    expect(provider.requests[0]?.model).toBe("t-model");
  });
});

describe("LLM translator inside i18n", () => {
  const target = { campaign: campaign(), language: "en" } as const;

  it("never receives the candidate's values (D70)", async () => {
    const provider = new FakeLlmProvider([echo, echo]);
    const resolver = createTextResolver({
      translator: createLlmTranslator(taskOptions(provider)),
      cache: new MemoryTranslationCache(),
    });

    const result = await resolver.resolve(
      {
        kind: "system",
        key: "system.confirm_value",
        params: { field: "firstName", value: "Mariangela" },
      },
      target,
    );

    expect(result.text).toMatch(/^EN Per «EN nome» ho capito:\nMariangela\n/);
    expect(JSON.stringify(provider.requests)).not.toContain("Mariangela");
  });

  it("falls back to Italian when the LLM drops a placeholder (D71, D72)", async () => {
    const provider = new FakeLlmProvider(['{"text":"Section of"}']);
    const resolver = createTextResolver({
      translator: createLlmTranslator(taskOptions(provider)),
      cache: new MemoryTranslationCache(),
    });

    const result = await resolver.resolve(
      { kind: "system", key: "system.progress", params: { current: 1, total: 3 } },
      target,
    );

    expect(result).toMatchObject({ text: "Sezione 1 di 3", language: "it", source: "fallback" });
  });
});
