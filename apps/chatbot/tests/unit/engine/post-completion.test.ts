import { describe, expect, it } from "vitest";
import type { CampaignInput } from "../../../src/campaigns/schema/campaign";
import type { EditConfirmation } from "../../../src/engine/state";
import { step } from "../../../src/engine/step";
import {
  answer,
  campaign,
  choice,
  flowState,
  inferred,
  interpretation,
  others,
  sent,
  userTurn,
} from "./helpers";

const completed = flowState({
  phase: "post_completion",
  stepId: null,
  consentsAccepted: true,
  profile: { firstName: inferred("Mario") },
});
const edit = interpretation({
  intent: "edit_request",
  editTarget: { field: "firstName", newValue: "Marco" },
});
const pending: EditConfirmation = {
  kind: "edit",
  field: "firstName",
  oldValue: "Mario",
  newValue: "Marco",
};
const withCv = (afterCompletion: CampaignInput["afterCompletion"]) =>
  campaign((input) => {
    input.flow.splice(4, 0, { id: "cv", type: "cv_offer", prompt: { it: "Vuoi il tuo CV?" } });
    input.afterCompletion = afterCompletion;
  });

describe("post-completion edits", () => {
  const c = campaign();

  it("asks to confirm an edit", () => {
    const result = step(completed, userTurn("mi chiamo Marco", edit), c);

    expect(sent(result.effects)).toEqual(["system.confirm_edit"]);
    expect(result.state.pendingConfirmation).toEqual(pending);
  });

  it("saves it on yes and notifies the Kubri platform", () => {
    const state = { ...completed, pendingConfirmation: pending };
    const result = step(state, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual([
      "ApplyPatch:edit:firstName",
      "EnqueueJob:kubri-webhook:profile.updated",
    ]);
    expect(sent(result.effects)).toEqual(["system.edit_saved"]);
    expect(result.state).toMatchObject({ phase: "post_completion", pendingConfirmation: null });
  });

  it("cancels it on no", () => {
    const state = { ...completed, pendingConfirmation: pending };
    const result = step(state, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.edit_cancelled"]);
    expect(others(result.effects)).toEqual([]);
  });

  it("drops it on any other message, which is handled normally (D36)", () => {
    const state = { ...completed, pendingConfirmation: pending };
    const result = step(state, userTurn("grazie", interpretation()), c);

    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
    expect(others(result.effects)).toEqual([]);
    expect(result.state.pendingConfirmation).toBeNull();
  });

  it("refuses edits when the campaign does not allow them", () => {
    const noEdits = campaign((input) => {
      input.afterCompletion = { allowEdits: false };
    });
    const result = step(completed, userTurn("mi chiamo Marco", edit), noEdits);

    expect(sent(result.effects)).toEqual(["system.edit_not_allowed"]);
  });

  it("rejects an invalid edit", () => {
    const invalid = interpretation({
      intent: "edit_request",
      editTarget: { field: "drivingLicense", newValue: "forse" },
    });
    const result = step(completed, userTurn("cambia la patente", invalid), c);

    expect(sent(result.effects)).toEqual(["system.edit_invalid"]);
  });

  it("ignores extracted values outside an edit request", () => {
    const result = step(completed, userTurn("Luigi", answer("firstName", "Luigi")), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
  });
});

describe("stale confirmations after completion (D53)", () => {
  it("drops a value confirmation, flags the session and handles the turn", () => {
    const state = {
      ...completed,
      pendingConfirmation: {
        kind: "value" as const,
        field: "firstName",
        value: "Mrio",
        confidence: 0.4,
      },
    };
    const result = step(state, userTurn("sì", choice("yes")), campaign());

    expect(others(result.effects)).toEqual(["FlagSession:stale_confirmation"]);
    expect(result.effects).toContainEqual({
      type: "FlagSession",
      reason: "stale_confirmation",
      needsAttention: true,
    });
    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
    expect(result.state).toMatchObject({ phase: "post_completion", pendingConfirmation: null });
    expect(result.state.profile.firstName?.value).toBe("Mario");
  });
});

describe("post-completion CV regeneration (D44)", () => {
  const c = withCv({ allowEdits: true, allowCvRegeneration: true });

  it("offers the CV again through the cv_offer step", () => {
    const result = step(completed, userTurn("rifammi il cv", choice("regenerate_cv")), c);

    expect(sent(result.effects)).toEqual(["cv"]);
    expect(result.state).toMatchObject({ phase: "post_completion", stepId: "cv" });
  });

  it("enqueues the CV on yes", () => {
    const result = step({ ...completed, stepId: "cv" }, userTurn("sì", choice("yes")), c);

    expect(others(result.effects)).toEqual(["EnqueueJob:cv"]);
    expect(sent(result.effects)).toEqual(["system.cv_requested"]);
    expect(result.state.stepId).toBeNull();
  });

  it("goes back to the help text on no", () => {
    const result = step({ ...completed, stepId: "cv" }, userTurn("no", choice("no")), c);

    expect(sent(result.effects)).toEqual(["system.post_completion_help"]);
    expect(result.state.stepId).toBeNull();
  });

  it("asks again on anything else", () => {
    const result = step({ ...completed, stepId: "cv" }, userTurn("boh", interpretation()), c);
    expect(sent(result.effects)).toEqual(["system.not_understood", "cv"]);
  });

  it("answers with the help text when regeneration is not allowed", () => {
    const noRegen = withCv({ allowEdits: true, allowCvRegeneration: false });
    const result = step(completed, userTurn("rifammi il cv", choice("regenerate_cv")), noRegen);

    expect(result.effects).toEqual([
      {
        type: "SendText",
        text: {
          kind: "system",
          key: "system.post_completion_help",
          params: { allowEdits: true, allowCvRegeneration: false },
        },
      },
    ]);
  });
});
