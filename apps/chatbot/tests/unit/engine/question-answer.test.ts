import { describe, expect, it } from "vitest";
import { step } from "../../../src/engine/step";
import {
  answer,
  atQuestion,
  campaign,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const c = campaign();

describe("answering the current question", () => {
  it("advances to the next question once the field is filled", () => {
    const result = step(atQuestion("nome"), userTurn("Mario", answer("firstName", "Mario")), c);

    expect(others(result.effects)).toEqual(["ApplyPatch:extraction:firstName"]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.questionId).toBe("patente");
  });

  it("asks a conditional question when its condition now holds", () => {
    const state = atQuestion("patente", { profile: { firstName: inferred("Mario") } });
    const result = step(state, userTurn("sì", answer("drivingLicense", true)), c);

    expect(sent(result.effects)).toEqual(["anagrafica.notte"]);
  });

  it("completes the block after the last open question", () => {
    const state = atQuestion("patente", { profile: { firstName: inferred("Mario") } });
    const result = step(state, userTurn("no", answer("drivingLicense", false)), c);

    expect(sent(result.effects)).toEqual(["fine"]);
    expect(others(result.effects)).toEqual([
      "ApplyPatch:extraction:drivingLicense",
      "EnqueueJob:kubri-webhook:block.completed",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
    expect(result.state.phase).toBe("post_completion");
  });

  it("skips questions answered in advance (spec §5.3)", () => {
    const interp = interpretation({
      patch: [
        { field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" },
        { field: "drivingLicense", value: false, confidence: 0.95, evidence: "niente patente" },
      ],
    });
    const result = step(atQuestion("nome"), userTurn("Mario, niente patente", interp), c);

    expect(others(result.effects)).toEqual([
      "ApplyPatch:extraction:firstName,drivingLicense",
      "EnqueueJob:kubri-webhook:block.completed",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
  });

  it("terminates the block when the answer meets terminateIf", () => {
    const withTerminate = campaign((input) => {
      input.flow[3] = {
        id: "anagrafica",
        type: "questions",
        questions: [
          { id: "nome", field: "firstName", prompt: { it: "Come ti chiami?" } },
          {
            id: "patente",
            field: "drivingLicense",
            prompt: { it: "Hai la patente?" },
            terminateIf: { field: "drivingLicense", eq: false },
          },
        ],
      };
    });
    const result = step(
      atQuestion("patente"),
      userTurn("no", answer("drivingLicense", false)),
      withTerminate,
    );

    expect(others(result.effects)).toEqual([
      "ApplyPatch:extraction:drivingLicense",
      "StopSession:terminated:delete",
    ]);
    expect(sent(result.effects)).toEqual(["system.stopped"]);
    expect(result.state.outcomes).toMatchObject({ anagrafica: "terminated" });
  });
});
