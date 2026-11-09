import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl } from "../../../../src/evals/jsonl";
import { CalibrationCaseSchema } from "../../../../src/evals/translation/calibration";
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

describe("dataset translation-calibration", () => {
  const path = "evals/datasets/translation-calibration.jsonl";

  it("is valid, with good and bad translations graded by a person", () => {
    const cases = parseJsonl(read(path), path, CalibrationCaseSchema);

    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases.some((c) => c.human.fidelity === 5)).toBe(true);
    expect(cases.some((c) => c.human.fidelity <= 3)).toBe(true);
  });
});
