import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { step } from "../../../src/engine/step";
import { atQuestion, campaign, inferred, interpretation, others, sent, userTurn } from "./helpers";

const c = campaign();
const nomePrompt = { kind: "step", path: "anagrafica.nome", text: { it: "Come ti chiami?" } };

const optionalNome = (maxClarifications: number): CampaignDefinition =>
  campaign((input) => {
    input.flow[3] = {
      id: "anagrafica",
      type: "questions",
      questions: [
        {
          id: "nome",
          field: "firstName",
          prompt: { it: "Come ti chiami?" },
          required: false,
          maxClarifications,
        },
        { id: "patente", field: "drivingLicense", prompt: { it: "Hai la patente?" } },
      ],
    };
  });

describe("clarifications", () => {
  it("rephrases the question when the answer is absent", () => {
    const result = step(atQuestion("nome"), userTurn("boh", interpretation()), c);

    expect(result.effects).toEqual([{ type: "SendText", text: nomePrompt, purpose: "rephrase" }]);
    expect(result.state.clarifications).toBe(1);
  });

  it("asks a targeted clarification on a partial answer, even with a value saved", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
      currentQuestion: { completeness: "partial", missing: "cognome" },
    });
    const result = step(atQuestion("nome"), userTurn("Mario", interp), c);

    expect(result.effects).toEqual([
      {
        type: "ApplyPatch",
        source: "extraction",
        fields: [{ field: "firstName", value: "Mario", confidence: 0.95, status: "inferred" }],
      },
      {
        type: "SendText",
        text: { ...nomePrompt, params: { missing: "cognome" } },
        purpose: "clarify",
      },
    ]);
    expect(result.state).toMatchObject({ questionId: "nome", clarifications: 1 });
  });

  it("advances on a partial answer once clarifications are used up, if a value exists", () => {
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "Mario" }],
      currentQuestion: { completeness: "partial", missing: "cognome" },
    });
    const result = step(atQuestion("nome", { clarifications: 2 }), userTurn("Mario", interp), c);

    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("marks a required field unresolved, flags the session and moves on", () => {
    const result = step(
      atQuestion("nome", { clarifications: 2 }),
      userTurn("non lo dico", interpretation()),
      c,
    );

    expect(others(result.effects)).toEqual([
      "MarkFieldUnresolved:firstName",
      "FlagSession:unresolved_field:firstName",
    ]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual({
      value: null,
      confidence: 0,
      status: "unresolved",
    });
  });

  it("skips an optional question silently once clarifications are used up", () => {
    const result = step(atQuestion("nome"), userTurn("boh", interpretation()), optionalNome(0));

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("skips an optional question at once on a refusal", () => {
    const result = step(
      atQuestion("nome"),
      userTurn("preferisco di no", interpretation({ intent: "refusal" })),
      optionalNome(2),
    );

    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it("treats a refusal of a required question like an absent answer", () => {
    const result = step(
      atQuestion("nome"),
      userTurn("preferisco di no", interpretation({ intent: "refusal" })),
      c,
    );

    expect(result.effects).toEqual([{ type: "SendText", text: nomePrompt, purpose: "rephrase" }]);
  });

  it("does not take a value saved earlier as the answer to this turn", () => {
    const state = atQuestion("nome", {
      clarifications: 1,
      profile: { firstName: inferred("Mario") },
    });
    const result = step(state, userTurn("boh", interpretation({ intent: "unclear" })), c);

    expect(result.effects).toEqual([{ type: "SendText", text: nomePrompt, purpose: "rephrase" }]);
    expect(result.state).toMatchObject({ questionId: "nome", clarifications: 2 });
  });

  it("does not take an identical re-extraction as an answer", () => {
    const state = atQuestion("nome", { profile: { firstName: inferred("Mario") } });
    const interp = interpretation({
      patch: [{ field: "firstName", value: "Mario", confidence: 0.95, evidence: "…" }],
      currentQuestion: { completeness: "absent" },
    });
    const result = step(state, userTurn("boh", interp), c);

    expect(result.effects).toEqual([{ type: "SendText", text: nomePrompt, purpose: "rephrase" }]);
    expect(result.state.questionId).toBe("nome");
  });

  it("keeps a value saved earlier once clarifications are used up", () => {
    const state = atQuestion("nome", {
      clarifications: 2,
      profile: { firstName: inferred("Mario") },
    });
    const result = step(state, userTurn("boh", interpretation({ intent: "unclear" })), c);

    expect(others(result.effects)).toEqual([]);
    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
    expect(result.state.profile.firstName).toEqual(inferred("Mario"));
  });

  it("advances on a complete answer that confirms the saved value", () => {
    const state = atQuestion("nome", { profile: { firstName: inferred("Mario") } });
    const interp = interpretation({ currentQuestion: { completeness: "complete" } });
    const result = step(state, userTurn("sì, è giusto", interp), c);

    expect(sent(result.effects)).toEqual(["anagrafica.patente"]);
  });

  it.each(["off_topic", "help"] as const)("%s does not use up a clarification", (intent) => {
    const result = step(atQuestion("nome"), userTurn("?", interpretation({ intent })), c);

    expect(result.state).toMatchObject({ questionId: "nome", clarifications: 0 });
  });
});
