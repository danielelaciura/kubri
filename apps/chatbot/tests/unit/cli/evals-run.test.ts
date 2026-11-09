import { describe, expect, it, vi } from "vitest";
import { CliError } from "../../../src/cli/deps";
import { createProgram } from "../../../src/cli/program";
import { FakeLlmProvider } from "../../../src/nlu/fake-provider";
import { LlmError } from "../../../src/nlu/llm-provider";
import { minimalCampaign } from "../campaigns/fixtures";
import { interpretationJson } from "../nlu/helpers";
import { fakeCli } from "./fake-deps";

const CASE = {
  id: "stop-1",
  language: "it",
  state: { step: "anagrafica", question: "nome" },
  message: "non scrivetemi più",
  expected: { intent: "opt_out" },
};
const FILES = {
  "c.json": JSON.stringify(minimalCampaign()),
  "evals/datasets/intent.jsonl": `${JSON.stringify(CASE)}\n`,
};

async function run(files: Record<string, string>, replies: (string | LlmError)[], args: string[]) {
  const llm = new FakeLlmProvider(replies);
  const cli = fakeCli(files, "test", [], llm);
  let error: unknown;
  try {
    await createProgram(cli.deps).parseAsync(["node", "kubri-bot", "evals", ...args]);
  } catch (e: unknown) {
    error = e;
  }
  return { ...cli, error, llm };
}

const RUN = ["run", "--suite", "intent", "--campaign", "c.json"];

describe("evals run", () => {
  it("runs the suite, writes the report as JSON and Markdown, and prints a summary", async () => {
    const { written, stdout, error, llm } = await run(
      FILES,
      [interpretationJson({ intent: "opt_out" })],
      RUN,
    );

    expect(error).toBeUndefined();
    const paths = Object.keys(written).sort();
    // The fake clock advances at every call, so the time in the name is not fixed.
    expect(paths).toEqual([
      expect.stringMatching(/^evals\/reports\/intent-[\dT-]+Z\.json$/),
      expect.stringMatching(/^evals\/reports\/intent-[\dT-]+Z\.md$/),
    ]);
    expect(written[paths[1] ?? ""]).toContain("# Evals · intent");
    expect(stdout.join("\n")).toContain("1/1 cases passed");
    expect(llm.requests).toHaveLength(1);
  });

  it("selects the prompt and the model (D99)", async () => {
    const { llm, error } = await run(
      FILES,
      [interpretationJson({ intent: "opt_out" })],
      [...RUN, "--prompt", "interpret-v1", "--model", "m-candidate"],
    );

    expect(error).toBeUndefined();
    expect(llm.requests[0]?.model).toBe("m-candidate");
  });

  it("measures only the model under test: no fallback model, and records who answered (D96)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    try {
      const busy = () => new LlmError("server", "busy");
      const pending = run(FILES, [busy(), busy(), busy(), interpretationJson()], RUN);
      await vi.runAllTimersAsync();
      const { llm, written } = await pending;

      expect(llm.requests.map((r) => r.model)).toEqual([
        "mistral-small-latest",
        "mistral-small-latest",
        "mistral-small-latest",
      ]);
      const json = Object.entries(written).find(([path]) => path.endsWith(".json"))?.[1] ?? "";
      expect(JSON.parse(json)).toMatchObject({
        meta: { models: { interpret: "mistral-small-latest", fallback: null } },
        cases: [{ failure: "unavailable", runScores: [{ answeredBy: null }] }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("records the model that answered each run", async () => {
    const { written } = await run(FILES, [interpretationJson({ intent: "opt_out" })], RUN);

    const json = Object.entries(written).find(([path]) => path.endsWith(".json"))?.[1] ?? "";
    expect(JSON.parse(json)).toMatchObject({
      metrics: { answeredBy: { "mistral-small-latest": 1 } },
      cases: [{ runScores: [{ answeredBy: "mistral-small-latest" }] }],
    });
  });

  it("fails with the known versions on an unknown prompt", async () => {
    const { error } = await run(FILES, [], [...RUN, "--prompt", "interpret-v9"]);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/known: interpret-v1/);
  });

  it("fails the gates (exit 1) when the intent accuracy is too low", async () => {
    const { error, stdout } = await run(FILES, [interpretationJson({ intent: "help" })], RUN);

    expect(error).toBeInstanceOf(CliError);
    expect((error as CliError).message).toMatch(/gates failed/i);
    expect(stdout.join("\n")).toContain("✗ intent accuracy");
  });

  it("fails a reply that stays invalid after the repair, and says so (E2)", async () => {
    const { error, written } = await run(FILES, ["nope", "still nope"], RUN);

    expect((error as CliError).message).toMatch(/gates failed/i);
    const markdown = Object.entries(written).find(([path]) => path.endsWith(".md"))?.[1];
    expect(markdown).toContain("`stop-1` (it) — invalid output after the repair");
  });

  it("repeats every case and records the deadline it measured against (E3, E6)", async () => {
    const reply = interpretationJson({ intent: "opt_out" });
    const { error, llm, written } = await run(FILES, [reply, reply], [...RUN, "--repeat", "2"]);

    expect(error).toBeUndefined();
    expect(llm.requests).toHaveLength(2);
    const json = Object.entries(written).find(([path]) => path.endsWith(".json"))?.[1] ?? "";
    expect(JSON.parse(json)).toMatchObject({
      meta: { repeat: 2, deadlineMs: 20_000 },
      cases: [{ id: "stop-1", nlu: { runs: 2, passed: 2 } }],
    });
  });

  it("refuses a repeat count that is not a positive whole number", async () => {
    const { error } = await run(FILES, [], [...RUN, "--repeat", "0"]);

    expect((error as CliError).message).toMatch(/--repeat/);
  });

  it("does not save the baseline when the gates fail (E5)", async () => {
    const { error, written, stdout } = await run(
      FILES,
      [interpretationJson({ intent: "help" })],
      [...RUN, "--save-baseline"],
    );

    expect((error as CliError).message).toMatch(/gates failed/i);
    expect(written["evals/baselines/intent.json"]).toBeUndefined();
    expect(stdout.join("\n")).toContain("baseline not saved");
  });

  it("saves a failing run as the baseline only with --force-baseline (E5)", async () => {
    const { error, written } = await run(
      FILES,
      [interpretationJson({ intent: "help" })],
      [...RUN, "--force-baseline"],
    );

    expect((error as CliError).message).toMatch(/gates failed/i);
    expect(written["evals/baselines/intent.json"]).toBeDefined();
  });

  it("compares with the baseline file and saves a new one on request", async () => {
    const first = await run(
      FILES,
      [interpretationJson({ intent: "opt_out" })],
      [...RUN, "--save-baseline"],
    );
    const baseline = first.written["evals/baselines/intent.json"];
    expect(baseline).toBeDefined();

    const second = await run(
      { ...FILES, "evals/baselines/intent.json": baseline ?? "" },
      [interpretationJson({ intent: "opt_out" })],
      RUN,
    );

    expect(second.error).toBeUndefined();
    expect(second.stdout.join("\n")).toContain("baseline: evals/baselines/intent.json");
  });

  it("fails, and saves no baseline, when the LLM never answered (D98)", async () => {
    const language = {
      id: "lingua-ar",
      language: "ar",
      state: { step: "anagrafica", question: "nome" },
      message: "مرحبا",
      expected: { language: "ar" },
    };
    const { error, written, stdout } = await run(
      { ...FILES, "evals/datasets/language.jsonl": `${JSON.stringify(language)}\n` },
      [new LlmError("client", "refused")],
      ["run", "--suite", "language", "--campaign", "c.json", "--save-baseline"],
    );

    expect((error as CliError).message).toMatch(/gates failed/i);
    expect(written["evals/baselines/language.json"]).toBeUndefined();
    expect(stdout.join("\n")).toContain("✗ unavailable");
  });

  it("explains a dataset problem with the line", async () => {
    const { error } = await run({ ...FILES, "evals/datasets/intent.jsonl": "{ nope\n" }, [], RUN);

    expect((error as CliError).message).toBe("evals/datasets/intent.jsonl:1: not valid JSON");
  });

  it("refuses to run without the LLM key", async () => {
    const cli = fakeCli(FILES, "test", []);
    await expect(
      createProgram(cli.deps).parseAsync(["node", "kubri-bot", "evals", ...RUN]),
    ).rejects.toThrow(/never reach the real LLM/);
  });
});

describe("evals compare", () => {
  it("prints the comparison of two report files", async () => {
    const first = await run(FILES, [interpretationJson({ intent: "opt_out" })], RUN);
    const report = Object.values(first.written)[0] ?? "";
    const cli = fakeCli({ "a.json": report, "b.json": report });

    await createProgram(cli.deps).parseAsync([
      "node",
      "kubri-bot",
      "evals",
      "compare",
      "a.json",
      "b.json",
    ]);

    expect(cli.stdout.join("\n")).toContain("Peggiorati");
  });
});
