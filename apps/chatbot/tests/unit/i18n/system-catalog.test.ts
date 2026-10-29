import { describe, expect, it } from "vitest";
import { SYSTEM_TEXT_KEYS, type TextParams } from "../../../src/engine/text-ref";
import type { LocalizedText } from "../../../src/i18n/localized-text";
import {
  I18N_TEXT_KEYS,
  SYSTEM_CATALOG,
  catalogText,
  type CatalogEntry,
} from "../../../src/i18n/system-catalog";
import { placeholdersOf } from "../../../src/i18n/template";

/** Every variant of an entry: one per combination of its flag parameters. */
function variants(entry: CatalogEntry): LocalizedText[] {
  const pick = entry.text;
  if (typeof pick !== "function") return [pick];
  const flags = Object.entries(entry.params)
    .filter(([, kind]) => kind === "flag")
    .map(([name]) => name);
  const combos = flags.reduce<Record<string, boolean>[]>(
    (all, flag) =>
      all.flatMap((c) => [
        { ...c, [flag]: true },
        { ...c, [flag]: false },
      ]),
    [{}],
  );
  return combos.map((params) => pick(params));
}

const it_ = (key: keyof typeof SYSTEM_CATALOG, params: TextParams = {}): string =>
  catalogText(SYSTEM_CATALOG[key], params)["it"] ?? "";

// The parameters the engine passes today (grep "systemText(" in src/engine).
const ENGINE_PARAMS: Record<string, string[]> = {
  "system.progress": ["current", "total"],
  "system.confirm_value": ["field", "value"],
  "system.confirm_edit": ["field", "newValue", "oldValue"],
  "system.post_completion_help": ["allowCvRegeneration", "allowEdits"],
};

describe("system catalog", () => {
  it("covers every engine key and every i18n key, nothing else", () => {
    expect(Object.keys(SYSTEM_CATALOG).sort()).toEqual(
      [...SYSTEM_TEXT_KEYS, ...I18N_TEXT_KEYS].sort(),
    );
  });

  it.each(SYSTEM_TEXT_KEYS)("%s declares exactly the parameters the engine passes", (key) => {
    expect(Object.keys(SYSTEM_CATALOG[key].params).sort()).toEqual(ENGINE_PARAMS[key] ?? []);
  });

  it.each(Object.keys(SYSTEM_CATALOG) as (keyof typeof SYSTEM_CATALOG)[])(
    "%s uses exactly its non-flag parameters, in every variant",
    (key) => {
      const entry = SYSTEM_CATALOG[key];
      const interpolated = Object.entries(entry.params)
        .filter(([, kind]) => kind !== "flag")
        .map(([name]) => name)
        .sort();
      for (const text of variants(entry)) {
        expect(text["it"]).toMatch(/\S/);
        expect(placeholdersOf(text["it"] ?? "")).toEqual(interpolated);
      }
    },
  );

  it("asks to answer yes to delete, in so many words", () => {
    expect(it_("system.delete_confirm").toLowerCase()).toContain("rispondi sì per cancellare");
  });

  it("asks for a yes or a no in the confirmations", () => {
    expect(it_("system.confirm_value")).toContain("Rispondi sì o no");
    expect(it_("system.confirm_edit")).toContain("Rispondi sì");
  });

  it("picks the post-completion variant from the two flags", () => {
    const both = it_("system.post_completion_help", {
      allowEdits: true,
      allowCvRegeneration: true,
    });
    const edits = it_("system.post_completion_help", {
      allowEdits: true,
      allowCvRegeneration: false,
    });
    const cv = it_("system.post_completion_help", { allowEdits: false, allowCvRegeneration: true });
    const none = it_("system.post_completion_help", {
      allowEdits: false,
      allowCvRegeneration: false,
    });

    expect(both).toContain("correggere");
    expect(both).toContain("CV");
    expect(edits).toContain("correggere");
    expect(edits).not.toContain("CV");
    expect(cv).toContain("CV");
    expect(cv).not.toContain("correggere");
    expect(none).not.toContain("CV");
    expect(none).not.toContain("correggere");
  });

  it("welcomes in Italian with an English line (spec §5.6)", () => {
    const [italian, english] = it_("system.welcome").split("\n");
    expect(italian).toContain("In che lingua");
    expect(english).toContain("Which language");
  });
});
