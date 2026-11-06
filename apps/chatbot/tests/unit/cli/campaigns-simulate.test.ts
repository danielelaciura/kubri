import { describe, expect, it } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { minimalCampaign } from "../campaigns/fixtures";
import { fakeCli } from "./fake-deps";

async function simulate(inputs: string[], content = JSON.stringify(minimalCampaign())) {
  const cli = fakeCli({ "c.json": content }, "test", inputs);
  let error: unknown;
  try {
    await createProgram(cli.deps).parseAsync([
      "node",
      "kubri-bot",
      "campaigns",
      "simulate",
      "c.json",
    ]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, error };
}

describe("campaigns simulate", () => {
  it("runs an interview until the operator quits", async () => {
    const { stdout, error, inputClosed } = await simulate([
      "italiano",
      "sì",
      "/quit",
      "never read",
    ]);
    const output = stdout.join("\n");

    expect(error).toBeUndefined();
    expect(stdout[0]).toBe(
      'Simulating "acme-magazzino" (nlu=naive, translator=fake). Type /? for the commands, /quit to stop.',
    );
    expect(output).toContain("bot> Ciao! Sono l'assistente di Kubri");
    expect(output).toContain("  · SetLanguage:it\nbot> Ciao! Ti farò qualche domanda.");
    expect(output).toContain("bot> Accetti l'informativa sulla privacy?");
    expect(inputClosed()).toBe(true);
  });

  it("stops at the end of the input", async () => {
    const { error, inputClosed, stdout } = await simulate(["italiano"]);

    expect(error).toBeUndefined();
    expect(inputClosed()).toBe(true);
    expect(stdout.at(-1)).toBe("bot> Sai cos'è un CV?");
  });

  it("refuses an invalid campaign before asking anything", async () => {
    const input = minimalCampaign();
    input.texts = {};

    const { error, stderr, inputClosed } = await simulate(["italiano"], JSON.stringify(input));

    expect(error).toBeInstanceOf(CliError);
    expect(stderr.join("\n")).toContain("unknown_text_ref");
    expect(inputClosed()).toBe(false);
  });
});
