import { describe, expect, it } from "vitest";
import type { CampaignDefinition, CampaignInput } from "../../../src/campaigns/schema/campaign";
import { advanceFromQuestion, enterStep, followOutcome } from "../../../src/engine/advance";
import type { SessionState } from "../../../src/engine/state";
import { createTurn, type Turn } from "../../../src/engine/turn";
import {
  AT,
  atQuestion,
  campaign,
  flowState,
  inferred,
  others,
  questionOf,
  questionsStep,
  sent,
  thrown,
} from "./helpers";

const turnFor = (state: SessionState, c: CampaignDefinition = campaign()): Turn =>
  createTurn(state, c, AT);

describe("enterStep", () => {
  it("sends a message and moves on to the next step that waits for an answer", () => {
    const turn = turnFor(flowState());
    enterStep(turn, 0);

    expect(sent(turn.effects)).toEqual(["intro", "cv_info"]);
    expect(turn.state.stepId).toBe("cv_info");
    expect(turn.state.outcomes).toEqual({ intro: "next" });
  });

  describe("step conditions", () => {
    const withNote = campaign((input) => {
      input.flow.splice(1, 0, {
        id: "license_note",
        type: "message",
        when: { field: "drivingLicense", eq: true },
        text: { it: "Bene, la patente è utile." },
      });
    });

    it("skips a step whose when is false, without recording an outcome", () => {
      const turn = turnFor(flowState(), withNote);
      enterStep(turn, 0);

      expect(sent(turn.effects)).toEqual(["intro", "cv_info"]);
      expect(turn.state.outcomes).toEqual({ intro: "next" });
    });

    it("enters it when its when holds", () => {
      const turn = turnFor(flowState({ profile: { drivingLicense: inferred(true) } }), withNote);
      enterStep(turn, 0);

      expect(sent(turn.effects)).toEqual(["intro", "license_note", "cv_info"]);
    });
  });

  it("sends a consent text with the data controller and the link as params", () => {
    const turn = turnFor(flowState());
    enterStep(turn, 2);

    expect(turn.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "step",
          path: "privacy",
          text: { it: "Accetti l'informativa sulla privacy?" },
          params: {
            "dataController.name": "ACME S.r.l.",
            "dataController.privacyUrl": "https://example.com/privacy",
            link: "https://example.com/privacy",
          },
        },
      },
    ]);
  });

  it("opens a questions block with progress, title and the first open question", () => {
    const c = campaign((input) => {
      const block = input.flow[3];
      if (block?.type === "questions") block.title = { it: "Parliamo di te" };
    });
    const turn = turnFor(flowState({ consentsAccepted: true }), c);
    enterStep(turn, 3);

    expect(sent(turn.effects)).toEqual(["system.progress", "anagrafica.title", "anagrafica.nome"]);
    expect(turn.effects[0]).toEqual({
      type: "SendText",
      text: { kind: "system", key: "system.progress", params: { current: 1, total: 1 } },
    });
    expect([turn.state.stepId, turn.state.questionId]).toEqual(["anagrafica", "nome"]);
  });

  it("completes a block with nothing left to ask and moves on", () => {
    const state = flowState({
      consentsAccepted: true,
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });
    const turn = turnFor(state);
    enterStep(turn, 3);

    expect(sent(turn.effects)).toEqual(["fine"]);
    expect(others(turn.effects)).toEqual([
      "EnqueueJob:kubri-webhook:block.completed",
      "CompleteSession",
      "EnqueueJob:kubri-webhook:interview.completed",
    ]);
    expect(turn.state.outcomes).toMatchObject({ anagrafica: "completed" });
    expect(turn.state.phase).toBe("post_completion");
  });

  it("terminates a block when an already filled question's terminateIf holds", () => {
    const c = campaign((input) => {
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
    const state = flowState({
      consentsAccepted: true,
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });
    const turn = turnFor(state, c);
    enterStep(turn, 3);

    expect(sent(turn.effects)).toEqual(["system.stopped"]);
    expect(others(turn.effects)).toEqual(["StopSession:terminated:keep"]);
    expect(turn.state.outcomes).toMatchObject({ anagrafica: "terminated" });
  });

  it("throws after 20 automatic advances", () => {
    const c = campaign((input) => {
      input.flow = Array.from({ length: 25 }, (_, i) => ({
        id: `m${i}`,
        type: "message" as const,
        text: { it: `Messaggio ${i}` },
      }));
    });
    const error = thrown(() => {
      enterStep(turnFor(flowState(), c), 0);
    });
    expect(error).toMatchObject({
      name: "EngineError",
      reason: "auto_advance_limit",
    });
  });
});

describe("followOutcome", () => {
  it("records the outcome, sends the reply, then repeats the step", () => {
    const turn = turnFor(flowState({ stepId: "cv_info" }));
    followOutcome(turn, 1, "idk");

    expect(sent(turn.effects)).toEqual(["texts.cv_explain", "cv_info"]);
    expect(turn.state.outcomes).toEqual({ cv_info: "idk" });
    expect(turn.state.stepId).toBe("cv_info");
  });

  it("@stop before the consent threshold deletes everything (D24)", () => {
    const turn = turnFor(flowState({ stepId: "cv_info" }));
    followOutcome(turn, 1, "no");

    expect(sent(turn.effects)).toEqual(["system.stopped"]);
    expect(others(turn.effects)).toEqual(["StopSession:flow_stop:delete"]);
    expect(turn.state).toMatchObject({ phase: "closed", stepId: null });
  });

  it("@stop after the threshold keeps the data by default (D57)", () => {
    const turn = turnFor(flowState({ stepId: "cv_info", consentsAccepted: true }));
    followOutcome(turn, 1, "no");

    expect(others(turn.effects)).toEqual(["StopSession:flow_stop:keep"]);
  });

  it("@stop after the threshold deletes when the campaign sets onStop delete", () => {
    const c = campaign((input) => {
      input.onStop = { data: "delete" };
    });
    const turn = turnFor(flowState({ stepId: "cv_info", consentsAccepted: true }), c);
    followOutcome(turn, 1, "no");

    expect(others(turn.effects)).toEqual(["StopSession:flow_stop:delete"]);
  });

  describe("@end (D37)", () => {
    const endOn = (edit: (input: CampaignInput) => void): CampaignDefinition =>
      campaign((input) => {
        input.flow[1] = {
          id: "cv_info",
          type: "choice",
          prompt: { it: "Sai cos'è un CV?" },
          options: [
            { id: "yes", description: "Sì" },
            { id: "no", description: "No" },
          ],
          on: { no: "@end" },
        };
        edit(input);
      });

    it("goes to the first end step whose when holds", () => {
      const c = endOn((input) => {
        input.flow.splice(2, 0, {
          id: "early_end",
          type: "end",
          when: { step: "cv_info", outcome: "yes" },
          text: { it: "A presto!" },
        });
      });
      const turn = turnFor(flowState({ stepId: "cv_info", consentsAccepted: true }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["fine"]);
      expect(others(turn.effects)).toEqual([
        "CompleteSession",
        "EnqueueJob:kubri-webhook:interview.completed",
      ]);
      expect(turn.state).toMatchObject({ phase: "post_completion", stepId: null });
    });

    it("before the consent threshold closes and deletes instead of completing (D24)", () => {
      const c = endOn((input) => {
        input.onStop = { data: "keep" };
      });
      const turn = turnFor(flowState({ stepId: "cv_info" }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["fine"]);
      expect(others(turn.effects)).toEqual(["StopSession:ended_before_consent:delete"]);
      expect(turn.state).toMatchObject({ phase: "closed", stepId: null });
    });

    it("picks an earlier end step when its when holds", () => {
      const c = endOn((input) => {
        input.flow.splice(2, 0, {
          id: "early_end",
          type: "end",
          when: { step: "cv_info", outcome: "no" },
          text: { it: "A presto!" },
        });
      });
      const turn = turnFor(flowState({ stepId: "cv_info" }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["early_end"]);
    });

    it("completes with the system closing when the flow has no end step", () => {
      const c = endOn((input) => {
        input.flow.pop();
      });
      const turn = turnFor(flowState({ stepId: "cv_info", consentsAccepted: true }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["system.closing"]);
      expect(others(turn.effects)).toEqual([
        "CompleteSession",
        "EnqueueJob:kubri-webhook:interview.completed",
      ]);
    });

    it("before the threshold, with no end step, closes with the system closing and deletes", () => {
      const c = endOn((input) => {
        input.flow.pop();
      });
      const turn = turnFor(flowState({ stepId: "cv_info" }), c);
      followOutcome(turn, 1, "no");

      expect(sent(turn.effects)).toEqual(["system.closing"]);
      expect(others(turn.effects)).toEqual(["StopSession:ended_before_consent:delete"]);
      expect(turn.state.phase).toBe("closed");
    });
  });

  describe("end steps are searched from the current position on", () => {
    const withEarlyBye = (edit?: (input: CampaignInput) => void): CampaignDefinition =>
      campaign((input) => {
        const cvInfo = input.flow[1];
        if (cvInfo?.type === "choice") cvInfo.on = { yes: "privacy", no: "bye" };
        input.flow.splice(2, 0, { id: "bye", type: "end", text: { it: "Ciao!" } });
        input.flow[5] = {
          id: "fine",
          type: "end",
          when: { step: "cv_info", outcome: "no" },
          text: { it: "Grazie!" },
        };
        edit?.(input);
      });
    const finishing = atQuestion("patente", {
      profile: { firstName: inferred("Mario"), drivingLicense: inferred(false) },
    });

    it("never jumps back to an earlier end step when the flow runs out", () => {
      const c = withEarlyBye();
      const block = questionsStep(c, "anagrafica");
      const turn = turnFor(finishing, c);
      advanceFromQuestion(turn, 4, block, questionOf(block, "patente"));

      expect(sent(turn.effects)).toEqual(["system.closing"]);
      expect(others(turn.effects)).toEqual([
        "EnqueueJob:kubri-webhook:block.completed",
        "CompleteSession",
        "EnqueueJob:kubri-webhook:interview.completed",
      ]);
    });

    it("never jumps back to an earlier end step on @end", () => {
      const c = withEarlyBye((input) => {
        const block = input.flow[4];
        if (block?.type === "questions") block.on = { completed: "@end" };
      });
      const block = questionsStep(c, "anagrafica");
      const turn = turnFor(finishing, c);
      advanceFromQuestion(turn, 4, block, questionOf(block, "patente"));

      expect(sent(turn.effects)).toEqual(["system.closing"]);
    });
  });

  it("running past the last step behaves like @end", () => {
    const c = campaign((input) => {
      input.flow = [{ id: "intro", type: "message", text: { it: "Ciao!" } }];
    });
    const turn = turnFor(flowState(), c);
    enterStep(turn, 0);

    expect(sent(turn.effects)).toEqual(["intro", "system.closing"]);
    expect(others(turn.effects)).toEqual(["StopSession:ended_before_consent:delete"]);
  });

  it("treats an unknown target as an incoherent state", () => {
    const c = campaign((input) => {
      const choiceStep = input.flow[1];
      if (choiceStep?.type === "choice") choiceStep.on = { no: "ghost" };
    });
    const error = thrown(() => {
      followOutcome(turnFor(flowState(), c), 1, "no");
    });
    expect(error).toMatchObject({
      reason: "incoherent_state",
    });
  });
});

describe("advanceFromQuestion", () => {
  it("asks the next open question and resets the clarifications", () => {
    const c = campaign();
    const block = questionsStep(c, "anagrafica");
    const turn = turnFor(
      atQuestion("nome", { clarifications: 2, profile: { firstName: inferred("Mario") } }),
      c,
    );
    advanceFromQuestion(turn, 3, block, questionOf(block, "nome"));

    expect(sent(turn.effects)).toEqual(["anagrafica.patente"]);
    expect(turn.state).toMatchObject({ questionId: "patente", clarifications: 0 });
  });

  it("treats a question outside the block as an incoherent state", () => {
    const c = campaign();
    const block = questionsStep(c, "anagrafica");
    const stranger = { ...questionOf(block, "nome"), id: "ghost" };
    const error = thrown(() => {
      advanceFromQuestion(turnFor(atQuestion("nome"), c), 3, block, stranger);
    });
    expect(error).toMatchObject({ reason: "incoherent_state" });
  });
});
