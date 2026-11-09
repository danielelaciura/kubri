import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CliError, type CliDeps } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { runProgram } from "../../../src/cli/run";
import type { LlmProvider, LlmRequest } from "../../../src/nlu/llm-provider";
import { TRANSLATE_SYSTEM_PROMPT } from "../../../src/nlu/prompts/translate-v1";
import { createNluServices } from "../../../src/nlu/services";
import { minimalCampaign } from "../campaigns/fixtures";
import { interpretationJson } from "../nlu/helpers";
import { fakeCli } from "./fake-deps";

const TextSchema = z.object({ text: z.string() });
const ContextSchema = z.object({ context: z.object({ history: z.array(z.string()) }) });

/** Answers interpret calls from a queue and translate calls with "EN <text>". */
function routingProvider(
  interpretations: string[],
): LlmProvider & { calls: string[]; requests: LlmRequest[] } {
  const queue = [...interpretations];
  const calls: string[] = [];
  const requests: LlmRequest[] = [];
  return {
    name: "fake",
    calls,
    requests,
    complete: (request) => {
      const translating = request.messages[0]?.content === TRANSLATE_SYSTEM_PROMPT;
      calls.push(translating ? "translate" : "interpret");
      requests.push(request);
      const content = translating
        ? JSON.stringify({
            text: `EN ${TextSchema.parse(JSON.parse(request.messages[1]?.content ?? "{}")).text}`,
          })
        : (queue.shift() ?? interpretationJson({ intent: "unclear" }));
      return Promise.resolve({
        content,
        model: request.model,
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    },
  };
}

async function run(deps: CliDeps, args: string[]): Promise<unknown> {
  try {
    await createProgram(deps).parseAsync([
      "node",
      "kubri-bot",
      "campaigns",
      "simulate",
      "c.json",
      ...args,
    ]);
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

const FILES = { "c.json": JSON.stringify(minimalCampaign()) };

describe("campaigns simulate with the LLM", () => {
  it("interprets plain answers with the LLM", async () => {
    const llm = routingProvider([
      interpretationJson(),
      interpretationJson({ intent: "choice", choice: "yes" }),
    ]);
    const cli = fakeCli(FILES, "test", ["italiano", "sì"], llm);

    expect(await run(cli.deps, ["--nlu", "llm"])).toBeUndefined();
    expect(cli.stdout[0]).toContain("(nlu=llm, translator=fake)");
    expect(cli.stdout.join("\n")).toContain("bot> Accetti l'informativa sulla privacy?");
    expect(llm.calls).toEqual(["interpret", "interpret"]);
  });

  it("keeps the commands ahead of the LLM (D79)", async () => {
    const llm = routingProvider([]);
    const cli = fakeCli(FILES, "test", ["/null italiano", "/choice idk"], llm);

    await run(cli.deps, ["--nlu", "llm"]);

    expect(llm.calls).toEqual([]);
    expect(cli.stdout.join("\n")).toContain("bot> Un CV è un documento");
  });

  it("translates with the LLM and prints the traces without content", async () => {
    const llm = routingProvider([
      interpretationJson({ language: { code: "en", confidence: 0.99 } }),
    ]);
    const cli = fakeCli(FILES, "test", ["english"], llm);

    await run(cli.deps, ["--nlu", "llm", "--translator", "llm", "--traces"]);

    expect(cli.stdout.join("\n")).toContain("bot[translated]> EN Ciao! Ti farò qualche domanda.");
    expect(
      cli.stderr.some((line) => line.startsWith("  ⋯ interpret mistral-small-latest primary")),
    ).toBe(true);
    expect(
      cli.stderr.some((line) => line.startsWith("  ⋯ translate mistral-small-latest primary")),
    ).toBe(true);
    expect(cli.stderr.every((line) => line.endsWith(" valid"))).toBe(true);
    expect(cli.stderr.join("\n")).not.toContain("Ciao");
    expect(cli.stderr.join("\n")).not.toContain("english");
  });

  it("prints no traces without --traces", async () => {
    const llm = routingProvider([interpretationJson()]);
    const cli = fakeCli(FILES, "test", ["italiano"], llm);

    await run(cli.deps, ["--nlu", "llm"]);

    expect(cli.stderr).toEqual([]);
  });

  it("gives the LLM as many earlier messages as --history says", async () => {
    const llm = routingProvider([
      interpretationJson(),
      interpretationJson({ intent: "choice", choice: "yes" }),
      interpretationJson({ intent: "unclear" }),
      interpretationJson({ intent: "unclear" }),
    ]);
    const cli = fakeCli(FILES, "test", ["italiano", "sì", "boh", "mah"], llm);

    await run(cli.deps, ["--nlu", "llm", "--history", "1"]);

    const last = llm.requests.at(-1)?.messages[1]?.content ?? "{}";
    expect(ContextSchema.parse(JSON.parse(last)).context.history).toEqual(["boh"]);
  });

  it("does not build the LLM for --nlu naive --translator fake", async () => {
    const cli = fakeCli(FILES, "test", ["italiano"]);
    const deps: CliDeps = {
      ...cli.deps,
      nlu: () => {
        throw new Error("must not be called");
      },
    };

    expect(await run(deps, [])).toBeUndefined();
  });

  it("explains a missing MISTRAL_API_KEY before asking anything", async () => {
    const cli = fakeCli(FILES, "test", ["italiano"]);
    const deps: CliDeps = { ...cli.deps, nlu: () => createNluServices({}) };

    const error = await run(deps, ["--translator", "llm"]);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/MISTRAL_API_KEY is not set/);
    expect(cli.inputClosed()).toBe(false);
  });

  it("prints the missing key as one line, with exit code 1", async () => {
    const cli = fakeCli(FILES, "test", ["italiano"]);
    const deps: CliDeps = { ...cli.deps, nlu: () => createNluServices({ MISTRAL_API_KEY: " " }) };

    const code = await runProgram(
      deps,
      ["node", "kubri-bot", "campaigns", "simulate", "c.json", "--nlu", "llm"],
      false,
    );

    expect(code).toBe(1);
    expect(cli.stderr).toHaveLength(1);
    expect(cli.stderr[0]).toMatch(/^MISTRAL_API_KEY is not set/);
    expect(cli.stderr[0]).not.toContain("\n");
    expect(cli.stdout).toEqual([]);
  });
});
