import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "../../../../src/evals/jsonl";
import { TranslationCaseSchema } from "../../../../src/evals/translation/case";

const ROOT = join(__dirname, "../../../..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("dataset translation", () => {
  const path = "evals/datasets/translation.jsonl";

  it("is valid and big enough to start with", () => {
    expect(parseJsonl(read(path), path, TranslationCaseSchema).length).toBeGreaterThanOrEqual(5);
  });

  it("covers a critical text and texts with placeholders", () => {
    const cases = parseJsonl(read(path), path, TranslationCaseSchema);

    expect(cases.some((c) => c.kind === "critical")).toBe(true);
    expect(cases.some((c) => /\{[A-Za-z]/.test(c.text))).toBe(true);
  });
});
