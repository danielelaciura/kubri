import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERPRET_PROMPT,
  INTERPRET_PROMPTS,
  interpretPromptFor,
} from "../../../src/nlu/prompts";

describe("interpret prompts", () => {
  it("knows interpret-v1 and uses it by default", () => {
    expect(Object.keys(INTERPRET_PROMPTS)).toEqual(["interpret-v1"]);
    expect(DEFAULT_INTERPRET_PROMPT.version).toBe("interpret-v1");
    expect(interpretPromptFor("interpret-v1")).toBe(DEFAULT_INTERPRET_PROMPT);
  });

  it("names the known versions when asked for an unknown one", () => {
    expect(() => interpretPromptFor("interpret-v9")).toThrow(/known: interpret-v1/);
    expect(() => interpretPromptFor("toString")).toThrow(/unknown prompt/);
  });
});
