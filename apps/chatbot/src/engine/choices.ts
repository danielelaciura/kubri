import type { CampaignDefinition } from "../campaigns/schema/campaign";
import {
  MAX_CHOICE_LABEL_LENGTH,
  type ChoiceStep,
  type QuestionsStep,
} from "../campaigns/schema/steps";
import type { LanguageCode, LocalizedText } from "../i18n/localized-text";
import { resolveField } from "../profile/field-ref";
import type { Interpretation } from "./interpretation";
import type { PendingConfirmation, SessionState } from "./state";

/** Catalog texts for the buttons (src/i18n/system-catalog.ts holds the wording). */
export type ChoiceLabelKey =
  "choice.yes" | "choice.no" | "choice.idk" | "choice.accepted" | "choice.declined";

export type ChoiceLabel =
  | { readonly kind: "catalog"; readonly key: ChoiceLabelKey }
  /** A short localized text, translated like any label (an option label, an enum value). */
  | { readonly kind: "text"; readonly text: LocalizedText }
  /** Shown as it is: the name of a language in that language. */
  | { readonly kind: "literal"; readonly text: string };

/** What a tap means to the engine (D114). */
export type ChoiceMeaning =
  | { readonly kind: "choice"; readonly choice: string }
  | { readonly kind: "value"; readonly field: string; readonly value: unknown }
  | { readonly kind: "language"; readonly code: LanguageCode };

export interface OfferedChoice {
  /**
   * What the channel sends back on a tap. Unique within the offer, and carrying the question
   * it belongs to (C1), so a tap on an old widget is not awaited any more.
   */
  readonly id: string;
  readonly label: ChoiceLabel;
  readonly meaning: ChoiceMeaning;
}

export interface ChoiceOffer {
  readonly options: readonly OfferedChoice[];
  /** The catalog text of the button that opens a list. */
  readonly listButton: "choice.list_button" | "choice.language_button";
}

/** WhatsApp lists hold ten rows. */
export const MAX_OFFERED_CHOICES = 10;

/** WhatsApp limit for the id of a list row: a longer id drops the widget (C1). */
export const MAX_CHOICE_ID_LENGTH = 200;

/** The ten languages offered at the start (D113), each named in its own language. */
export const OFFERED_LANGUAGES: readonly { readonly code: LanguageCode; readonly name: string }[] =
  [
    { code: "it", name: "Italiano" },
    { code: "en", name: "English" },
    { code: "ar", name: "العربية" },
    { code: "fr", name: "Français" },
    { code: "es", name: "Español" },
    { code: "uk", name: "Українська" },
    { code: "ro", name: "Română" },
    { code: "sq", name: "Shqip" },
    { code: "bn", name: "বাংলা" },
    { code: "ur", name: "اردو" },
  ];

const catalog = (key: ChoiceLabelKey): ChoiceLabel => ({ kind: "catalog", key });

/** A choice whose meaning is the engine's choice id (yes, no, accepted, …). */
const choice = (prefix: string, meaning: string, key: ChoiceLabelKey): OfferedChoice => ({
  id: `${prefix}:${meaning}`,
  label: catalog(key),
  meaning: { kind: "choice", choice: meaning },
});

const yesNo = (prefix: string): readonly OfferedChoice[] => [
  choice(prefix, "yes", "choice.yes"),
  choice(prefix, "no", "choice.no"),
];

const LIST: ChoiceOffer["listButton"] = "choice.list_button";
const offer = (options: readonly OfferedChoice[]): ChoiceOffer => ({ options, listButton: LIST });

const CATALOG_OPTION_LABELS: Readonly<Record<string, ChoiceLabelKey>> = {
  yes: "choice.yes",
  no: "choice.no",
  idk: "choice.idk",
};

function confirmationPrefix(pending: PendingConfirmation): string {
  return pending.kind === "delete_data"
    ? "confirm:delete_data"
    : `confirm:${pending.kind}:${pending.field}`;
}

function choiceStepOffer(step: ChoiceStep): ChoiceOffer | null {
  if (step.options.length > MAX_OFFERED_CHOICES) return null;
  const options: OfferedChoice[] = [];
  for (const option of step.options) {
    const key = Object.hasOwn(CATALOG_OPTION_LABELS, option.id)
      ? CATALOG_OPTION_LABELS[option.id]
      : undefined;
    const label: ChoiceLabel | undefined = option.label
      ? { kind: "text", text: option.label }
      : key
        ? catalog(key)
        : undefined;
    // One option without a label and the whole question is asked in plain text.
    if (!label) return null;
    options.push({
      id: `step:${step.id}:${option.id}`,
      label,
      meaning: { kind: "choice", choice: option.id },
    });
  }
  return offer(options);
}

function questionOffer(
  step: QuestionsStep,
  questionId: string | null,
  campaign: CampaignDefinition,
): ChoiceOffer | null {
  const question = step.questions.find((q) => q.id === questionId);
  const def = question ? resolveField(question.field, campaign.customFields) : undefined;
  if (!question || !def || def.systemOnly) return null;
  const prefix = `q:${question.id}`;
  if (def.type === "bool") {
    return offer([
      {
        id: `${prefix}:yes`,
        label: catalog("choice.yes"),
        meaning: { kind: "value", field: question.field, value: true },
      },
      {
        id: `${prefix}:no`,
        label: catalog("choice.no"),
        meaning: { kind: "value", field: question.field, value: false },
      },
    ]);
  }
  const values = def.type === "enum" ? def.options : undefined;
  if (!values || values.length < 2 || values.length > MAX_OFFERED_CHOICES) return null;
  // A cut label would make two options look alike: such an enum is asked in plain text.
  if (values.some((value) => Array.from(value).length > MAX_CHOICE_LABEL_LENGTH)) return null;
  return offer(
    values.map((value) => ({
      id: `${prefix}:${value}`,
      label: { kind: "text", text: { it: value } },
      meaning: { kind: "value", field: question.field, value },
    })),
  );
}

function offerFor(state: SessionState, campaign: CampaignDefinition): ChoiceOffer | null {
  if (state.phase === "closed") return null;
  if (state.pendingConfirmation) return offer(yesNo(confirmationPrefix(state.pendingConfirmation)));
  if (state.phase === "language") {
    return {
      listButton: "choice.language_button",
      options: OFFERED_LANGUAGES.map(({ code, name }) => ({
        id: `lang:${code}`,
        label: { kind: "literal", text: name },
        meaning: { kind: "language", code },
      })),
    };
  }
  const step = state.stepId === null ? undefined : campaign.flow.find((s) => s.id === state.stepId);
  if (!step) return null;
  // After the interview only a CV regeneration being offered waits for a yes/no (D44).
  if (state.phase === "post_completion") {
    return step.type === "cv_offer" ? offer(yesNo(`cv:${step.id}`)) : null;
  }
  switch (step.type) {
    case "consent":
      return offer([
        choice(`consent:${step.id}`, "accepted", "choice.accepted"),
        choice(`consent:${step.id}`, "declined", "choice.declined"),
      ]);
    case "cv_offer":
      return offer(yesNo(`cv:${step.id}`));
    case "choice":
      return choiceStepOffer(step);
    case "questions":
      return questionOffer(step, state.questionId, campaign);
    case "message":
    case "end":
      return null;
  }
}

/**
 * D112, D113: the closed answers the engine is waiting for right now, from the state alone.
 * null = a free-text answer (or nothing) is expected. The same function builds the widget on
 * the way out and recognizes the tap on the way in.
 */
export function awaitedChoices(
  state: SessionState,
  campaign: CampaignDefinition,
): ChoiceOffer | null {
  const result = offerFor(state, campaign);
  // Meta refuses a row id longer than 200 characters: such a question is asked in plain text.
  if (result?.options.some((o) => o.id.length > MAX_CHOICE_ID_LENGTH)) return null;
  return result;
}

/** A tap, as the engine understands it: full confidence, no LLM involved (D114). */
export function interpretationForChoice(
  option: OfferedChoice,
  language: LanguageCode,
  title: string,
): Interpretation {
  const base = {
    language: { code: language, confidence: 1 },
    patch: [],
    currentQuestion: { completeness: "absent" as const },
  };
  switch (option.meaning.kind) {
    case "choice":
      return { ...base, intent: "choice", choice: option.meaning.choice };
    case "value":
      return {
        ...base,
        intent: "answer",
        patch: [
          {
            field: option.meaning.field,
            value: option.meaning.value,
            confidence: 1,
            evidence: title,
          },
        ],
        currentQuestion: { completeness: "complete" },
      };
    case "language":
      return { ...base, language: { code: option.meaning.code, confidence: 1 }, intent: "answer" };
  }
}

/** The interpretation of a tap, or null when its id is not one of the awaited choices. */
export function interpretReply(
  state: SessionState,
  campaign: CampaignDefinition,
  reply: { readonly id: string; readonly title: string },
): Interpretation | null {
  const option = awaitedChoices(state, campaign)?.options.find((o) => o.id === reply.id);
  if (!option) return null;
  return interpretationForChoice(option, state.language ?? campaign.defaultLanguage, reply.title);
}
