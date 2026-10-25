import { describe, expect, it } from "vitest";
import type { SessionState } from "../../../src/engine/state";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { buildInterpretContext } from "../../../src/nlu/context";
import { createLlmInterpreter, interpretContext } from "../../../src/nlu/interpret";
import type { InterpretRequest } from "../../../src/nlu/interpreter";
import { LlmError } from "../../../src/nlu/llm-provider";
import { INTERPRET_SYSTEM_PROMPT } from "../../../src/nlu/prompts/interpret-v1";
import { MemoryTraceSink, traceInput } from "../../../src/nlu/trace";
import { atQuestion, campaign, inferred } from "../engine/helpers";
import { interpretationJson, NOW, taskOptions } from "./helpers";

const MARIO = {
  patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
  currentQuestion: { completeness: "complete" },
};

function request(state: SessionState = atQuestion("nome"), text = "Mario"): InterpretRequest {
  return { text, state, campaign: campaign(), history: [], turnId: "turn-1" };
}

describe("createLlmInterpreter", () => {
  it("returns the validated interpretation and writes one trace", async () => {
    const provider = new FakeLlmProvider([interpretationJson(MARIO)]);
    const traces = new MemoryTraceSink();

    const result = await createLlmInterpreter(taskOptions(provider, traces)).interpret(request());

    expect(result).toMatchObject({ intent: "answer", patch: MARIO.patch });
    expect(provider.requests[0]).toMatchObject({
      model: "mistral-small-latest",
      temperature: 0,
      responseFormat: "json",
      timeoutMs: 15_000,
    });
    expect(provider.requests[0]?.messages[0]?.content).toBe(INTERPRET_SYSTEM_PROMPT);
    expect(traces.records).toMatchObject([
      {
        turnId: "turn-1",
        task: "interpret",
        promptVersion: "interpret-v1",
        provider: "fake",
        model: "mistral-small-latest",
        attempt: "primary",
        repair: false,
        valid: true,
        inputTokens: 100,
        outputTokens: 20,
        error: null,
        at: NOW,
      },
    ]);
    expect(traces.records[0]?.input).toEqual(traceInput(provider.requests[0]?.messages ?? []));
    expect(traces.records[0]?.input.map((m) => m.role)).toEqual(["user"]);
  });

  it("normalizes nulls and language codes without a repair call (D83)", async () => {
    const provider = new FakeLlmProvider([
      interpretationJson({
        ...MARIO,
        language: { code: "it-IT", confidence: 0.9 },
        choice: null,
        offTopicReply: null,
        editTarget: null,
      }),
    ]);

    const result = await createLlmInterpreter(taskOptions(provider)).interpret(request());

    expect(result?.language.code).toBe("it");
    expect(provider.requests).toHaveLength(1);
  });

  it("repairs an invalid output once, and traces the repair with its own messages", async () => {
    const provider = new FakeLlmProvider(["{ not json", interpretationJson(MARIO)]);
    const traces = new MemoryTraceSink();

    const result = await createLlmInterpreter(taskOptions(provider, traces)).interpret(request());

    expect(result?.patch).toEqual(MARIO.patch);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]?.messages).toHaveLength(4);
    expect(provider.requests[1]?.messages[3]?.content).toContain("the reply is not a JSON object");
    expect(traces.records.map((r) => [r.repair, r.valid])).toEqual([
      [false, false],
      [true, true],
    ]);
    expect(traces.records[1]?.input).toEqual(traceInput(provider.requests[1]?.messages ?? []));
    expect(traces.records[1]?.input.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("repairs an edit of a field that is not collected", async () => {
    const provider = new FakeLlmProvider([
      interpretationJson({
        intent: "edit_request",
        editTarget: { field: "drivingLicense", newValue: true },
      }),
      interpretationJson({
        patch: [{ field: "drivingLicense", value: true, confidence: 0.95, evidence: "patente" }],
      }),
    ]);

    const result = await createLlmInterpreter(taskOptions(provider)).interpret(request());

    expect(result?.intent).toBe("answer");
    expect(provider.requests[1]?.messages[3]?.content).toContain("editTarget.field");
  });

  it("falls back to unclear, in the session language, after a failed repair", async () => {
    const provider = new FakeLlmProvider(['{"intent":"dance"}', "still not json"]);
    const state = atQuestion("nome", { language: "en" });

    expect(await createLlmInterpreter(taskOptions(provider)).interpret(request(state))).toEqual({
      language: { code: "en", confidence: 0 },
      intent: "unclear",
      patch: [],
      currentQuestion: { completeness: "absent" },
    });
  });

  it("falls back to unclear when the repair call finds the LLM unavailable", async () => {
    const down = () => new LlmError("server", "Mistral HTTP 503", 503);
    const provider = new FakeLlmProvider(["nope", down(), down(), down(), down()]);
    const traces = new MemoryTraceSink();

    const result = await createLlmInterpreter(taskOptions(provider, traces)).interpret(request());

    expect(result?.intent).toBe("unclear");
    expect(traces.records.filter((r) => r.repair)).toHaveLength(4);
  });

  it("returns null when the LLM is unavailable, after retries and fallback (D82)", async () => {
    const down = () => new LlmError("server", "Mistral HTTP 503", 503);
    const provider = new FakeLlmProvider([down(), down(), down(), down()]);
    const traces = new MemoryTraceSink();
    const options = taskOptions(provider, traces);

    expect(await createLlmInterpreter(options).interpret(request())).toBeNull();
    expect(options.timing.slept).toEqual([500, 1500]);
    expect(provider.requests.at(-1)?.model).toBe("mistral-medium-latest");
    expect(traces.records.map((r) => r.attempt)).toEqual(["primary", "retry", "retry", "fallback"]);
    expect(traces.records.every((r) => r.error === "server: Mistral HTTP 503")).toBe(true);
  });

  it("returns null at once on a client error", async () => {
    const provider = new FakeLlmProvider([new LlmError("client", "Mistral HTTP 401", 401)]);

    expect(await createLlmInterpreter(taskOptions(provider)).interpret(request())).toBeNull();
    expect(provider.requests).toHaveLength(1);
  });

  it("is not affected by a failing trace sink (D87)", async () => {
    const provider = new FakeLlmProvider([interpretationJson(MARIO)]);
    const broken = { write: () => Promise.reject(new Error("db down")) };

    const result = await createLlmInterpreter(taskOptions(provider, broken)).interpret(request());

    expect(result?.intent).toBe("answer");
  });

  it("tells the LLM about a pending confirmation, without its value (D84)", async () => {
    const provider = new FakeLlmProvider([interpretationJson({ intent: "choice", choice: "yes" })]);
    const state = atQuestion("nome", {
      pendingConfirmation: { kind: "value", field: "firstName", value: "Mrio", confidence: 0.5 },
    });

    await createLlmInterpreter(taskOptions(provider)).interpret(request(state, "sì"));

    const user = provider.requests[0]?.messages[1]?.content ?? "";
    const payload = JSON.parse(user) as {
      context: { pendingConfirmation: unknown; expectedChoices: { id: string }[] };
    };
    expect(payload.context.pendingConfirmation).toEqual({ kind: "value", field: "firstName" });
    expect(payload.context.expectedChoices.map((c) => c.id)).toEqual(["yes", "no"]);
    expect(user).not.toContain("Mrio");
  });

  it("checks the output against the turn's context: a yes never carries a patch (D84)", async () => {
    const provider = new FakeLlmProvider([
      interpretationJson({ ...MARIO, intent: "choice", choice: "yes" }),
    ]);
    const state = atQuestion("patente", {
      profile: { firstName: inferred("Mario") },
      pendingConfirmation: { kind: "edit", field: "firstName", oldValue: "Mario", newValue: "M" },
    });

    const result = await createLlmInterpreter(taskOptions(provider)).interpret(
      request(state, "sì"),
    );

    expect(result).toMatchObject({ intent: "choice", choice: "yes", patch: [] });
  });
});

describe("interpretContext (for evals)", () => {
  const context = () => buildInterpretContext(request(), 3);

  it("interprets a prepared context and returns the raw reply and the traces", async () => {
    const provider = new FakeLlmProvider([interpretationJson(MARIO)]);
    const sink = new MemoryTraceSink();

    const result = await interpretContext(
      { context: context(), message: "Mario", turnId: null, defaultLanguage: "it" },
      taskOptions(provider, sink),
    );

    expect(result).toMatchObject({
      interpretation: { intent: "answer", patch: MARIO.patch },
      raw: interpretationJson(MARIO),
      valid: true,
      repaired: false,
    });
    expect(result.traces).toHaveLength(1);
    expect(sink.records).toEqual(result.traces);
  });

  it("reports a repair, and unclear after a failed one", async () => {
    const repaired = await interpretContext(
      { context: context(), message: "Mario", turnId: null, defaultLanguage: "it" },
      taskOptions(new FakeLlmProvider(["nope", interpretationJson(MARIO)])),
    );
    expect(repaired).toMatchObject({ valid: true, repaired: true });
    expect(repaired.traces.map((t) => t.repair)).toEqual([false, true]);

    const failed = await interpretContext(
      { context: context(), message: "Mario", turnId: null, defaultLanguage: "fr" },
      taskOptions(new FakeLlmProvider(["nope", "still nope"])),
    );
    expect(failed).toMatchObject({
      interpretation: { intent: "unclear", language: { code: "it", confidence: 0 } },
      raw: "still nope",
      valid: false,
      repaired: true,
    });
  });

  it("returns null with no raw reply when the LLM is unavailable", async () => {
    const provider = new FakeLlmProvider([new LlmError("client", "Mistral HTTP 401", 401)]);

    const result = await interpretContext(
      { context: context(), message: "Mario", turnId: null, defaultLanguage: "it" },
      taskOptions(provider),
    );

    expect(result).toMatchObject({
      interpretation: null,
      raw: null,
      valid: false,
      repaired: false,
    });
    expect(result.traces).toHaveLength(1);
  });
});
