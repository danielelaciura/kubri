import type { OutboundChoices } from "./channel";

// WhatsApp's limits for interactive messages (D115).
export const INTERACTIVE_BODY_LIMIT = 1024;
export const BUTTON_COUNT_LIMIT = 3;
export const BUTTON_TITLE_LIMIT = 20;
export const ROW_COUNT_LIMIT = 10;
export const ROW_TITLE_LIMIT = 24;
export const LIST_BUTTON_LIMIT = 20;

/** Cuts by characters, not UTF-16 units (Arabic and Bengali are not one unit per letter). */
export function truncate(text: string, max: number): string {
  const characters = Array.from(text);
  return characters.length <= max ? text : `${characters.slice(0, max - 1).join("")}…`;
}

export interface WidgetOption {
  readonly id: string;
  readonly title: string;
}

export type WidgetShape =
  | { readonly kind: "buttons"; readonly buttons: readonly WidgetOption[] }
  | { readonly kind: "list"; readonly button: string; readonly rows: readonly WidgetOption[] }
  | { readonly kind: "none" };

const cut = (picks: readonly WidgetOption[], max: number): WidgetOption[] =>
  picks.map(({ id, title }) => ({ id, title: truncate(title, max) }));

/** D115: buttons for 2–3 options, a list for 4–10, plain text otherwise. */
export function shapeChoices(choices: OutboundChoices): WidgetShape {
  const count = choices.options.length;
  if (count < 2 || count > ROW_COUNT_LIMIT) return { kind: "none" };
  if (count <= BUTTON_COUNT_LIMIT) {
    return { kind: "buttons", buttons: cut(choices.options, BUTTON_TITLE_LIMIT) };
  }
  return {
    kind: "list",
    button: truncate(choices.listButton, LIST_BUTTON_LIMIT),
    rows: cut(choices.options, ROW_TITLE_LIMIT),
  };
}
