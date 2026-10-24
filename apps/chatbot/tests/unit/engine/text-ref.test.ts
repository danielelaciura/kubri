import { describe, expect, it } from "vitest";
import {
  describeTextRef,
  stepTextRef,
  toTextParam,
  type TextParamValue,
  type TextRef,
} from "../../../src/engine/text-ref";

describe("stepTextRef", () => {
  it("keeps an inline text with the path of its step", () => {
    expect(stepTextRef({ it: "Ciao!" }, "intro")).toEqual({
      kind: "step",
      path: "intro",
      text: { it: "Ciao!" },
    });
  });

  it("turns a {ref} into a campaign text reference", () => {
    expect(stepTextRef({ ref: "cv_explain" }, "cv_info")).toEqual({
      kind: "campaign",
      key: "cv_explain",
    });
  });

  it("carries params only when given", () => {
    expect(stepTextRef({ it: "Ciao {name}" }, "intro", { name: "x" })).toEqual({
      kind: "step",
      path: "intro",
      text: { it: "Ciao {name}" },
      params: { name: "x" },
    });
    expect(stepTextRef({ ref: "cv_explain" }, "cv_info")).not.toHaveProperty("params");
  });
});

describe("describeTextRef", () => {
  it.each([
    [{ kind: "campaign", key: "cv_explain" }, "texts.cv_explain"],
    [{ kind: "step", path: "anagrafica.nome", text: { it: "Come ti chiami?" } }, "anagrafica.nome"],
    [{ kind: "system", key: "system.welcome" }, "system.welcome"],
    [{ kind: "generated", text: "Sono qui per il colloquio." }, "generated"],
  ] as [TextRef, string][])("%j → %s", (ref, id) => {
    expect(describeTextRef(ref)).toBe(id);
  });
});

describe("toTextParam", () => {
  it.each([
    ["Mario", "Mario"],
    [3, 3],
    [true, true],
    [null, null],
    [undefined, null],
    [
      ["B", "C"],
      ["B", "C"],
    ],
    [{ a: 1 }, '{"a":1}'],
    [[1, 2], "[1,2]"],
  ] as [unknown, TextParamValue][])("%j → %j", (value, expected) => {
    expect(toTextParam(value)).toEqual(expected);
  });
});
