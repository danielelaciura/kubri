import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "../../../src/campaigns/schema/campaign";
import { initialSessionState, type SessionState } from "../../../src/engine/state";
import { buildInterpretContext } from "../../../src/nlu/context";
import { atQuestion, campaign, flowState, inferred } from "../engine/helpers";

const c = campaign();
const build = (state: SessionState, history: string[] = [], cc: CampaignDefinition = c, n = 3) =>
  buildInterpretContext({ text: "x", state, campaign: cc, history, turnId: null }, n);

describe("buildInterpretContext", () => {
  it("is almost empty in the language phase", () => {
    expect(build(initialSessionState(), ["ciao"])).toEqual({
      phase: "language",
      sessionLanguage: null,
      step: null,
      question: null,
      openFields: [],
      collected: [],
      pendingConfirmation: null,
      expectedChoices: [],
      history: ["ciao"],
    });
  });

  it("describes a choice step with its options, in Italian", () => {
    const context = build(flowState({ stepId: "cv_info" }));

    expect(context.step).toEqual({ id: "cv_info", type: "choice", prompt: "Sai cos'è un CV?" });
    expect(context.expectedChoices).toEqual([
      { id: "yes", description: "Sa cos'è un CV e vuole proseguire" },
      { id: "no", description: "Non vuole proseguire" },
      { id: "idk", description: "Non sa cos'è un CV" },
    ]);
    // Before the consent threshold nothing could be saved: no fields offered.
    expect(context.openFields).toEqual([]);
  });

  it("offers accepted/declined and the fields on a consent step (D50)", () => {
    const context = build(flowState({ stepId: "privacy" }));

    expect(context.step).toEqual({
      id: "privacy",
      type: "consent",
      consentKey: "acme_privacy",
      optional: false,
      purpose: "informativa privacy di ACME S.r.l., l'azienda di questa candidatura",
    });
    expect(context.expectedChoices.map((choice) => choice.id)).toEqual(["accepted", "declined"]);
    expect(context.openFields.map((f) => f.field)).toEqual([
      "firstName",
      "drivingLicense",
      "custom.night_shifts",
    ]);
  });

  it("explains the optional kubri_global consent in plain words (D48)", () => {
    const withGlobal = campaign((input) => {
      input.flow.splice(3, 0, {
        id: "globale",
        type: "consent",
        consentKey: "kubri_global",
        textVersion: "2026-10",
        text: { it: "Vuoi essere visibile anche ad altre organizzazioni?" },
        optional: true,
      });
    });

    expect(build(flowState({ stepId: "globale" }), [], withGlobal).step).toEqual({
      id: "globale",
      type: "consent",
      consentKey: "kubri_global",
      optional: true,
      purpose: "visibilità del profilo ad altre organizzazioni del pool global di Kubri",
    });
  });

  it("gives the field format when the field has one", () => {
    const withEmail = campaign((input) => {
      const step = input.flow.find((s) => s.id === "anagrafica");
      if (step?.type !== "questions") throw new Error("fixture changed");
      step.questions.push({ id: "mail", field: "email", prompt: { it: "La tua email?" } });
    });

    expect(build(atQuestion("mail"), [], withEmail).question).toMatchObject({
      field: "email",
      type: "text",
      format: "email",
    });
  });

  it("describes the current question and the campaign's other open fields (D86)", () => {
    const context = build(atQuestion("nome"));

    expect(context.question).toEqual({
      id: "nome",
      field: "firstName",
      type: "text",
      description: "Nome di battesimo del candidato.",
      prompt: "Come ti chiami?",
      required: true,
    });
    // Conditional questions included: their condition may become true in this very message.
    expect(context.openFields).toEqual([
      {
        field: "drivingLicense",
        type: "bool",
        description: "Possiede una patente di guida valida. Patente scaduta o sospesa = false.",
      },
      {
        field: "custom.night_shifts",
        type: "bool",
        description: "Disponibile a lavorare di notte.",
      },
    ]);
    expect(context.expectedChoices).toEqual([]);
  });

  it("tells an optional question apart and carries its hint (D56)", () => {
    const optional = campaign((input) => {
      const step = input.flow.find((s) => s.id === "anagrafica");
      if (step?.type !== "questions") throw new Error("fixture changed");
      step.questions[1] = {
        id: "patente",
        field: "drivingLicense",
        prompt: { it: "Hai la patente?" },
        required: false,
        hint: "Solo la patente B conta.",
      };
    });

    expect(build(atQuestion("patente"), [], optional).question).toMatchObject({
      id: "patente",
      required: false,
      hint: "Solo la patente B conta.",
    });
  });

  it("summarizes collected fields, withholding personal data (D85)", () => {
    const context = build(
      atQuestion("notte", {
        profile: {
          firstName: inferred("Mariangela"),
          drivingLicense: inferred(true),
          lat: inferred(44.5),
          transport: { value: null, confidence: 0, status: "unresolved" },
        },
      }),
    );

    expect(context.collected).toEqual([
      { field: "firstName", description: "Nome di battesimo del candidato.", withheld: true },
      {
        field: "drivingLicense",
        description: "Possiede una patente di guida valida. Patente scaduta o sospesa = false.",
        value: true,
      },
    ]);
    expect(context.openFields).toEqual([]);
  });

  it("withholds the values of sensitive fields, standard or custom", () => {
    const sensitive = campaign((input) => {
      input.customFields = [
        {
          key: "disability",
          type: "text",
          label: { it: "Invalidità" },
          description: "Invalidità civile dichiarata.",
          sensitive: true,
        },
      ];
    });
    const context = build(
      atQuestion("patente", {
        profile: {
          workingPermit: inferred(false),
          "jobPreferences.constraints": inferred("devo accudire mia madre"),
          "custom.disability": inferred("invalidità al 40%"),
        },
      }),
      [],
      sensitive,
    );

    expect(context.collected.map((c) => [c.field, "withheld" in c])).toEqual([
      ["workingPermit", true],
      ["jobPreferences.constraints", true],
      ["custom.disability", true],
    ]);
    expect(JSON.stringify(context)).not.toContain("madre");
    expect(JSON.stringify(context)).not.toContain("40%");
  });

  it("sends the saved part of a partial answer to the current question only (§8.2)", () => {
    const withAddress = campaign((input) => {
      const step = input.flow.find((s) => s.id === "anagrafica");
      if (step?.type !== "questions") throw new Error("fixture changed");
      step.questions.unshift({
        id: "indirizzo",
        field: "address",
        prompt: { it: "Dove abiti? Via, numero e comune." },
      });
    });
    const profile = {
      address: inferred("Via Garibaldi"),
      firstName: inferred("Mariangela"),
    };

    const atAddress = build(atQuestion("indirizzo", { profile }), [], withAddress);
    const atName = build(
      atQuestion("nome", { profile: { address: profile.address } }),
      [],
      withAddress,
    );

    expect(atAddress.question?.savedValue).toBe("Via Garibaldi");
    expect(atAddress.collected).toContainEqual(
      expect.objectContaining({ field: "address", withheld: true }),
    );
    expect(JSON.stringify(atAddress)).not.toContain("Mariangela");
    // Elsewhere the address is not needed: it stays withheld.
    expect(atName.question).not.toHaveProperty("savedValue");
    expect(JSON.stringify(atName)).not.toContain("Garibaldi");
  });

  it("carries a pending value confirmation without its value, and expects yes/no (D84)", () => {
    const context = build(
      atQuestion("nome", {
        pendingConfirmation: { kind: "value", field: "firstName", value: "Mrio", confidence: 0.5 },
      }),
    );

    expect(context.pendingConfirmation).toEqual({ kind: "value", field: "firstName" });
    expect(context.expectedChoices.map((choice) => choice.id)).toEqual(["yes", "no"]);
    expect(JSON.stringify(context)).not.toContain("Mrio");
  });

  it("carries a pending deletion in any phase", () => {
    const context = build({
      ...initialSessionState(),
      phase: "post_completion",
      language: "it",
      pendingConfirmation: { kind: "delete_data" },
    });

    expect(context.pendingConfirmation).toEqual({ kind: "delete_data" });
    expect(context.expectedChoices.map((choice) => choice.id)).toEqual(["yes", "no"]);
  });

  it("offers regenerate_cv after completion only when the campaign allows it", () => {
    const done: SessionState = {
      ...initialSessionState(),
      phase: "post_completion",
      language: "it",
    };
    const withCv = campaign((input) => {
      input.afterCompletion = { allowEdits: true, allowCvRegeneration: true };
    });

    expect(build(done).expectedChoices).toEqual([]);
    expect(build(done, [], withCv).expectedChoices.map((choice) => choice.id)).toEqual([
      "regenerate_cv",
    ]);
    expect(build(done).openFields).toEqual([]);
  });

  it("keeps only the last N earlier messages, or none", () => {
    expect(build(flowState(), ["a", "b", "c", "d"]).history).toEqual(["b", "c", "d"]);
    expect(build(flowState(), ["a", "b"], c, 0).history).toEqual([]);
  });
});
