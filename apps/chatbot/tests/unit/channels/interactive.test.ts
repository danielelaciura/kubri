import { describe, expect, it } from "vitest";
import {
  BUTTON_TITLE_LIMIT,
  INTERACTIVE_BODY_LIMIT,
  LIST_BUTTON_LIMIT,
  ROW_TITLE_LIMIT,
  shapeChoices,
  truncate,
} from "../../../src/channels/interactive";

const choices = (n: number, title = (i: number) => `Voce ${i}`) => ({
  listButton: "Scegli",
  options: Array.from({ length: n }, (_, i) => ({ id: `o${i}`, title: title(i) })),
});

describe("limits (D115)", () => {
  it("are WhatsApp's", () => {
    expect([
      INTERACTIVE_BODY_LIMIT,
      BUTTON_TITLE_LIMIT,
      ROW_TITLE_LIMIT,
      LIST_BUTTON_LIMIT,
    ]).toEqual([1024, 20, 24, 20]);
  });
});

describe("truncate", () => {
  it("leaves a short text alone and cuts a long one with an ellipsis, in characters", () => {
    expect(truncate("Sì", 20)).toBe("Sì");
    expect(truncate("abcdefghij", 5)).toBe("abcd…");
    expect(Array.from(truncate("العربية العربية", 6))).toHaveLength(6);
  });
});

describe("shapeChoices", () => {
  it("makes buttons for two or three options", () => {
    expect(shapeChoices(choices(2))).toEqual({
      kind: "buttons",
      buttons: [
        { id: "o0", title: "Voce 0" },
        { id: "o1", title: "Voce 1" },
      ],
    });
    expect(shapeChoices(choices(3)).kind).toBe("buttons");
  });

  it("makes a list for four to ten options, with the button that opens it", () => {
    const shape = shapeChoices(choices(10));

    expect(shape).toMatchObject({ kind: "list", button: "Scegli" });
    expect(shape.kind === "list" && shape.rows).toHaveLength(10);
  });

  it("makes nothing for fewer than two or more than ten", () => {
    expect(shapeChoices(choices(1))).toEqual({ kind: "none" });
    expect(shapeChoices(choices(0))).toEqual({ kind: "none" });
    expect(shapeChoices(choices(11))).toEqual({ kind: "none" });
  });

  it("cuts titles to the limit of their kind", () => {
    const long = "x".repeat(30);

    const buttons = shapeChoices(choices(2, () => long));
    const list = shapeChoices({
      listButton: "y".repeat(30),
      options: choices(4, () => long).options,
    });

    expect(buttons.kind === "buttons" && Array.from(buttons.buttons[0]?.title ?? "")).toHaveLength(
      20,
    );
    expect(list.kind === "list" && Array.from(list.rows[0]?.title ?? "")).toHaveLength(24);
    expect(list.kind === "list" && Array.from(list.button)).toHaveLength(20);
  });
});
