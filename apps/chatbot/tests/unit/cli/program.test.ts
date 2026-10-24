import { describe, expect, it } from "vitest";
import { createProgram } from "../../../src/cli/program";
import { VERSION } from "../../../src/version";
import { fakeCli } from "./fake-deps";

function runCli(args: string[]): { output: string; error: unknown } {
  let output = "";
  const program = createProgram(fakeCli().deps)
    .exitOverride()
    .configureOutput({
      writeOut: (text) => {
        output += text;
      },
      writeErr: (text) => {
        output += text;
      },
    });
  try {
    program.parse(["node", "kubri-bot", ...args]);
    return { output, error: undefined };
  } catch (error: unknown) {
    return { output, error };
  }
}

describe("kubri-bot CLI", () => {
  it("prints the version", () => {
    expect(runCli(["--version"]).output.trim()).toBe(VERSION);
  });

  it("shows its name in the help", () => {
    expect(runCli(["--help"]).output).toContain("Usage: kubri-bot");
  });

  it.each(["orgs", "senders", "campaigns"])("lists the %s command in the help", (name) => {
    expect(runCli(["--help"]).output).toContain(name);
  });
});
