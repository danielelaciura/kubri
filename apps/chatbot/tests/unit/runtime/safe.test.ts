import { pino } from "pino";
import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { initialSessionState } from "../../../src/engine/state";
import type { Interpreter } from "../../../src/nlu/interpreter";
import { interpretSafely, stepSafely } from "../../../src/runtime/safe";
import { campaign, interpretation } from "../engine/helpers";

const logger = pino({ level: "silent" });
const REQUEST = {
  text: "ciao",
  state: initialSessionState(),
  campaign: campaign(),
  history: [],
  turnId: "t1",
};

describe("interpretSafely (D107)", () => {
  it("returns the interpretation", async () => {
    const interpreter: Interpreter = { interpret: () => Promise.resolve(interpretation()) };

    expect(await interpretSafely(interpreter, REQUEST, 500, logger)).toEqual({
      interpretation: interpretation(),
      problem: null,
    });
  });

  it("treats the NLU being unavailable (null) as a normal answer", async () => {
    const interpreter: Interpreter = { interpret: () => Promise.resolve(null) };

    expect(await interpretSafely(interpreter, REQUEST, 500, logger)).toEqual({
      interpretation: null,
      problem: null,
    });
  });

  it("gives up at the deadline", async () => {
    const interpreter: Interpreter = { interpret: () => new Promise(() => undefined) };

    expect(await interpretSafely(interpreter, REQUEST, 20, logger)).toEqual({
      interpretation: null,
      problem: "timeout",
    });
  });

  it.each([
    ["rejects", { interpret: () => Promise.reject(new Error("boom")) }],
    [
      "throws at once",
      {
        interpret: () => {
          throw new Error("boom");
        },
      },
    ],
  ] as const)("treats an interpreter that %s as unavailable", async (_name, interpreter) => {
    expect(await interpretSafely(interpreter, REQUEST, 500, logger)).toEqual({
      interpretation: null,
      problem: "error",
    });
  });
});

describe("stepSafely (D107)", () => {
  it("runs the engine", () => {
    const result = stepSafely(
      initialSessionState(),
      { type: "session_started", at: "2026-10-24T10:00:00.000Z" },
      campaign(),
      logger,
    );

    expect(result.crashed).toBe(false);
    expect(result.state.phase).toBe("language");
    expect(result.effects.map((e) => e.type)).toEqual(["SendText"]);
  });

  it("turns an exception that is not an EngineError into a generic error and a flag", () => {
    const broken = {
      get flow(): never {
        throw new Error("boom");
      },
    } as unknown as CampaignDefinition;
    const state = { ...initialSessionState(), phase: "flow" as const, stepId: "x" };

    const result = stepSafely(
      state,
      { type: "user_turn", at: "2026-10-24T10:00:00.000Z", text: "ciao", interpretation: null },
      broken,
      logger,
    );

    expect(result).toMatchObject({ crashed: true, state });
    expect(result.effects).toEqual([
      { type: "SendText", text: { kind: "system", key: "system.generic_error" } },
      { type: "FlagSession", reason: "incoherent_state", needsAttention: true },
    ]);
  });
});
