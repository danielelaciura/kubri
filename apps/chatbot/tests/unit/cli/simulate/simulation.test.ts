import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CampaignDefinition } from "../../../../src/campaigns/schema/campaign";
import { validateCampaign } from "../../../../src/campaigns/validate";
import { naiveInterpreter } from "../../../../src/cli/simulate/naive-interpreter";
import {
  createSimulation,
  formatBotText,
  type Simulation,
} from "../../../../src/cli/simulate/simulation";
import { FakeTranslator } from "../../../../src/i18n/fake-translator";
import { createTextResolver } from "../../../../src/i18n/resolve";
import { MemoryTranslationCache } from "../../../../src/i18n/translation-cache";
import type { InterpretRequest, Interpreter } from "../../../../src/nlu/interpreter";
import { resolveField } from "../../../../src/profile/field-ref";
import { campaign } from "../../engine/helpers";

function load(path: string): CampaignDefinition {
  const result = validateCampaign(JSON.parse(readFileSync(path, "utf8")));
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.campaign;
}

function simulate(c: CampaignDefinition, interpreter: Interpreter = naiveInterpreter): Simulation {
  let minute = 0;
  return createSimulation({
    campaign: c,
    interpreter,
    resolver: createTextResolver({
      translator: new FakeTranslator(),
      cache: new MemoryTranslationCache(),
    }),
    now: () => new Date(Date.UTC(2026, 9, 24, 10, minute++)).toISOString(),
    historySize: 3,
  });
}

const SAMPLES: Record<string, string> = {
  text: "Esempio",
  bool: "sì",
  number: "3",
  date: "12/05/1990",
  list: "uno, due",
  email: "mario.rossi@example.com",
  e164: "+393331234567",
  "iso-country": "MA",
  "iso-language": "ar",
};

/** What a cooperative candidate would answer at this point of the interview. */
function autoAnswer(sim: Simulation, c: CampaignDefinition): string {
  const { state } = sim;
  if (state.phase === "language") return "italiano";
  const step = c.flow.find((s) => s.id === state.stepId);
  switch (step?.type) {
    case "consent":
    case "cv_offer":
      return "sì";
    case "choice":
      return step.options[0]?.id ?? "1";
    case "questions": {
      const question = step.questions.find((q) => q.id === state.questionId);
      const def = question ? resolveField(question.field, c.customFields) : undefined;
      if (!def) return "boh";
      if (def.type === "enum") return def.options?.[0] ?? "boh";
      return SAMPLES[def.format ?? def.type] ?? "boh";
    }
    default:
      return "ok";
  }
}

async function interviewToTheEnd(
  c: CampaignDefinition,
): Promise<{ sim: Simulation; lines: string[] }> {
  const sim = simulate(c);
  const lines = await sim.start();
  for (let i = 0; i < 80 && sim.state.phase !== "post_completion"; i++) {
    lines.push(...((await sim.handle(autoAnswer(sim, c))) ?? []));
  }
  return { sim, lines };
}

describe("simulation", () => {
  it("starts with the welcome, in the campaign's default language", async () => {
    const lines = await simulate(campaign()).start();

    expect(lines[0]).toMatch(/^bot> Ciao! Sono l'assistente di Kubri/);
    expect(lines[1]).toMatch(/^ {5}Hi! I'm Kubri's assistant/);
  });

  it("shows the bot texts and the other effects of a turn", async () => {
    const sim = simulate(campaign());
    await sim.start();

    expect(await sim.handle("italiano")).toEqual([
      "  · SetLanguage:it",
      "bot> Ciao! Ti farò qualche domanda.",
      "bot> Sai cos'è un CV?",
    ]);
  });

  it("resolves the turn's texts in the language it just chose (D77)", async () => {
    const sim = simulate(campaign());
    await sim.start();

    expect(await sim.handle("english")).toEqual([
      "  · SetLanguage:en",
      "bot[translated]> [en] Ciao! Ti farò qualche domanda.",
      "bot[translated]> [en] Sai cos'è un CV?",
    ]);
  });

  it("passes the earlier user messages to the interpreter, commands excluded", async () => {
    const requests: InterpretRequest[] = [];
    const spy: Interpreter = {
      interpret: (request) => {
        requests.push(request);
        return naiveInterpreter.interpret(request);
      },
    };
    const sim = simulate(campaign(), spy);
    await sim.start();

    await sim.handle("italiano");
    await sim.handle("/choice idk");
    await sim.handle("sì");

    expect(requests.map((r) => r.history)).toEqual([[], ["italiano"]]);
    expect(requests.every((r) => r.turnId === null)).toBe(true);
  });

  it("keeps in the history the copy redacted with the patch evidence", async () => {
    const requests: InterpretRequest[] = [];
    const spy: Interpreter = {
      interpret: (request) => {
        requests.push(request);
        return Promise.resolve({
          language: { code: "it", confidence: 1 },
          intent: "answer",
          patch: [
            { field: "firstName", value: "Mariangela", confidence: 0.4, evidence: "Mariangela" },
          ],
          currentQuestion: { completeness: "complete" },
        });
      },
    };
    const sim = simulate(campaign(), spy);
    await sim.start();

    await sim.handle("mi chiamo Mariangela");
    await sim.handle("ok");

    expect(requests.map((r) => r.history)).toEqual([[], ["mi chiamo [firstName]"]]);
  });

  it("treats a failing interpreter as an unavailable NLU", async () => {
    const sim = simulate(campaign(), { interpret: () => Promise.reject(new Error("boom")) });
    await sim.start();
    await sim.handle("/null italiano");

    expect(await sim.handle("sì")).toEqual([
      "! interpreter failed: boom",
      "bot> Scusa, non ho capito bene. Puoi scriverlo in un altro modo?",
      "bot> Sai cos'è un CV?",
    ]);
  });

  it("prints the state and quits on request", async () => {
    const sim = simulate(campaign());
    await sim.start();
    await sim.handle("italiano");

    expect((await sim.handle("/state"))?.[0]).toBe(
      "phase=flow step=cv_info question=- language=it consentsAccepted=false clarifications=0 pending=none",
    );
    expect(await sim.handle("/quit")).toBeNull();
  });

  it("explains an invalid command without calling the engine", async () => {
    const sim = simulate(campaign());
    await sim.start();

    expect(await sim.handle("/dance")).toEqual(["! unknown command /dance: /? lists the commands"]);
    expect(sim.state.phase).toBe("language");
  });

  it("runs a whole interview of the test campaign", async () => {
    const c = load(join(__dirname, "../../../scenarios/campaigns/test-campaign.json"));

    const { sim, lines } = await interviewToTheEnd(c);

    expect(sim.state.phase).toBe("post_completion");
    expect(lines.some((line) => line.includes("FlagSession"))).toBe(false);
    expect(lines).toContain("  · CompleteSession");
    expect(sim.state.profile["firstName"]?.value).toBe("Esempio");
  });

  it("runs a whole interview of the standard Kubri campaign", async () => {
    const c = load(join(__dirname, "../../../../campaigns/kubri-standard.json"));

    const { sim, lines } = await interviewToTheEnd(c);

    expect(sim.state.phase).toBe("post_completion");
    expect(lines.some((line) => line.includes("FlagSession"))).toBe(false);
    expect(sim.state.profile["country"]?.value).toBe("MA");
  });
});

describe("formatBotText", () => {
  it("indents the following lines under the label", () => {
    expect(
      formatBotText({
        text: "uno\ndue",
        language: "en",
        source: "cache",
        isCurated: false,
        critical: false,
        missingParams: [],
      }),
    ).toEqual(["bot[cache]> uno", "            due"]);
  });
});
