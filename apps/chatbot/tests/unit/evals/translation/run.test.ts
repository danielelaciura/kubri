import { describe, expect, it } from "vitest";
import { parseJsonl } from "../../../../src/evals/jsonl";
import { TranslationCaseSchema } from "../../../../src/evals/translation/case";
import {
  runTranslationCases,
  summarizeTranslation,
  translationReportToMarkdown,
} from "../../../../src/evals/translation/run";
import { FakeTranslator } from "../../../../src/i18n/fake-translator";
import type { Translator } from "../../../../src/i18n/translator";
import type { Judge } from "../../../../src/nlu/judge";

const cases = parseJsonl(
  [
    { id: "progress-en", language: "en", kind: "system", text: "Sezione {current} di {total}" },
    { id: "consent-fr", language: "fr", kind: "critical", text: "Accetti di proseguire?" },
  ]
    .map((c) => JSON.stringify(c))
    .join("\n"),
  "t.jsonl",
  TranslationCaseSchema,
);

const judgeGiving = (fidelity: number, naturalness: number): Judge => ({
  score: () => Promise.resolve({ fidelity, naturalness, issues: [], model: "judge-2411" }),
});

const HEADER = {
  translateModel: "translate-m",
  judgeModel: "judge-m",
  judgePromptVersion: "judge-v1",
  calibration: "calibrated",
} as const;

describe("runTranslationCases", () => {
  it("translates, checks the placeholders, judges, and decides pass or fail", async () => {
    const results = await runTranslationCases(cases, new FakeTranslator(), judgeGiving(5, 4));

    expect(results.map((r) => [r.id, r.status, r.placeholdersOk, r.pass])).toEqual([
      ["progress-en", "ok", true, true],
      ["consent-fr", "ok", true, true],
    ]);
    expect(results[0]).toMatchObject({
      translation: "[en] Sezione {current} di {total}",
      translatedBy: "fake",
      judgedBy: "judge-2411",
    });
  });

  it("requires fidelity 5 for a critical text, 4 for the others", async () => {
    const results = await runTranslationCases(cases, new FakeTranslator(), judgeGiving(4, 5));

    expect(results.map((r) => r.pass)).toEqual([true, false]);
  });

  it("fails a translation that lost a placeholder, without trusting the judge", async () => {
    const lossy: Translator = {
      translate: () => Promise.resolve({ text: "Section", provider: "p", model: "m" }),
    };

    const [first] = await runTranslationCases(cases, lossy, judgeGiving(5, 5));

    expect(first).toMatchObject({ placeholdersOk: false, pass: false });
  });

  it("records a failing translator and a failing judge", async () => {
    const broken: Translator = { translate: () => Promise.reject(new Error("down")) };
    const noJudge: Judge = { score: () => Promise.resolve(null) };

    const a = await runTranslationCases(cases, broken, judgeGiving(5, 5));
    const b = await runTranslationCases(cases, new FakeTranslator(), noJudge);

    expect(a.every((r) => r.status === "translator_failed" && !r.pass)).toBe(true);
    expect(b.every((r) => r.status === "judge_failed" && !r.pass && r.judgedBy === null)).toBe(
      true,
    );
  });
});

describe("summarizeTranslation and the Markdown", () => {
  it("averages the scores by language and kind, and lists the models that answered", async () => {
    const results = await runTranslationCases(cases, new FakeTranslator(), judgeGiving(4, 5));

    const summary = summarizeTranslation(results);

    expect(summary).toMatchObject({
      cases: 2,
      passed: 1,
      passRate: 0.5,
      placeholderFailures: 0,
      translatorFailures: 0,
      answeredBy: { translate: ["fake"], judge: ["judge-2411"] },
    });
    expect(summary.byLanguage["en"]).toEqual({
      cases: 1,
      passed: 1,
      passRate: 1,
      meanFidelity: 4,
      meanNaturalness: 5,
    });
    expect(summary.byKind["critical"]?.passed).toBe(0);
    const md = translationReportToMarkdown(HEADER, summary, results);
    expect(md).toContain("`consent-fr`");
    expect(md).toContain("giudice: judge-m (judge-v1, risposte da judge-2411)");
    expect(md).not.toContain("NON TARATO");
  });

  it("says loudly when the judge was not calibrated (E8)", async () => {
    const results = await runTranslationCases(cases, new FakeTranslator(), judgeGiving(5, 5));

    const md = translationReportToMarkdown(
      { ...HEADER, calibration: "uncalibrated" },
      summarizeTranslation(results),
      results,
    );

    expect(md).toContain("NON TARATO");
  });
});
