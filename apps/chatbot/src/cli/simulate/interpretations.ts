import type { CampaignDefinition } from "../../campaigns/schema/campaign";
import { isNoKeyword, isYesKeyword } from "../../engine/global-intents";
import type { Interpretation } from "../../engine/interpretation";
import { normalizeText } from "../../engine/normalize-text";
import type { SessionState } from "../../engine/state";
import type { FieldDefinition } from "../../profile/field-definition";
import { resolveField } from "../../profile/field-ref";

/** Nothing understood yet. Confidence 0.5: below D41's 0.8, the engine keeps its default. */
export function baseInterpretation(
  state: SessionState,
  campaign: CampaignDefinition,
): Interpretation {
  return {
    language: { code: state.language ?? campaign.defaultLanguage, confidence: 0.5 },
    intent: "answer",
    patch: [],
    currentQuestion: { completeness: "absent" },
  };
}

export interface CurrentField {
  readonly ref: string;
  readonly definition: FieldDefinition;
}

/** The field of the question waiting for an answer, if any. */
export function currentField(
  state: SessionState,
  campaign: CampaignDefinition,
): CurrentField | undefined {
  if (state.phase !== "flow" || state.questionId === null) return undefined;
  const step = campaign.flow.find((s) => s.id === state.stepId);
  if (step?.type !== "questions") return undefined;
  const question = step.questions.find((q) => q.id === state.questionId);
  if (!question) return undefined;
  const definition = resolveField(question.field, campaign.customFields);
  return definition ? { ref: question.field, definition } : undefined;
}

function toIsoDate(text: string): string | undefined {
  const italian = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (italian) {
    const [, day = "", month = "", year = ""] = italian;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

/** Text typed in the terminal → a value of the field's type; undefined when it is not one. */
export function coerceValue(text: string, field: FieldDefinition): unknown {
  const trimmed = text.trim();
  switch (field.type) {
    case "bool":
      if (isYesKeyword(trimmed)) return true;
      return isNoKeyword(trimmed) ? false : undefined;
    case "number": {
      const value = Number(trimmed.replace(",", "."));
      return trimmed !== "" && Number.isFinite(value) ? value : undefined;
    }
    case "date":
      return toIsoDate(trimmed);
    case "enum":
      return field.options?.find((option) => normalizeText(option) === normalizeText(trimmed));
    case "list": {
      const items = trimmed
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter((item) => item !== "");
      return items.length > 0 ? items : undefined;
    }
    case "text":
      if (trimmed === "") return undefined;
      if (field.format === "iso-country") return trimmed.toUpperCase();
      if (field.format === "iso-language") return trimmed.toLowerCase();
      return trimmed;
  }
}
