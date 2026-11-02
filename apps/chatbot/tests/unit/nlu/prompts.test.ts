import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTERPRET_PROMPT,
  INTERPRET_PROMPTS,
  interpretPromptFor,
} from "../../../src/nlu/prompts";
import { INTERPRET_SYSTEM_PROMPT as V1_SYSTEM } from "../../../src/nlu/prompts/interpret-v1";
import { INTERPRET_SYSTEM_PROMPT as V2_SYSTEM } from "../../../src/nlu/prompts/interpret-v2";

describe("interpret prompts", () => {
  it("keeps interpret-v1 and uses interpret-v2 by default (D144)", () => {
    expect(Object.keys(INTERPRET_PROMPTS)).toEqual(["interpret-v1", "interpret-v2"]);
    expect(DEFAULT_INTERPRET_PROMPT.version).toBe("interpret-v2");
    expect(interpretPromptFor("interpret-v2")).toBe(DEFAULT_INTERPRET_PROMPT);
    expect(interpretPromptFor("interpret-v1").system).toBe(V1_SYSTEM);
    expect(DEFAULT_INTERPRET_PROMPT.system).toBe(V2_SYSTEM);
  });

  it("names the known versions when asked for an unknown one", () => {
    expect(() => interpretPromptFor("interpret-v9")).toThrow(/known: interpret-v1, interpret-v2/);
    expect(() => interpretPromptFor("toString")).toThrow(/unknown prompt/);
  });
});
