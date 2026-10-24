import type { CampaignDefinition } from "../campaigns/schema/campaign";
import type { Effect } from "../engine/effects";
import type { TextParamValue, TextParams, TextRef } from "../engine/text-ref";
import type { FieldDefinition } from "../profile/field-definition";
import { resolveField } from "../profile/field-ref";
import { consentStepOf, officialLink } from "./critical";
import { fieldLabel } from "./field-labels";
import type { LanguageCode, LocalizedText } from "./localized-text";
import {
  SYSTEM_CATALOG,
  catalogText,
  type CatalogEntry,
  type CatalogKey,
  type I18nTextKey,
} from "./system-catalog";
import { interpolate } from "./template";
import {
  resolveTemplate,
  type ResolvedTemplate,
  type TemplateServices,
  type TemplateSource,
} from "./translate-template";

export interface TextTarget {
  /** The definition of the version the session is pinned to. */
  readonly campaign: CampaignDefinition;
  readonly language: LanguageCode;
}

export type TextSource = TemplateSource | "generated";

export interface ResolvedText {
  readonly text: string;
  /** The language actually sent: Italian after a fallback (D72). */
  readonly language: LanguageCode;
  readonly source: TextSource;
  /** Reviewed by a person (D73): runtime stores it in Consent.textShownIsCurated. */
  readonly isCurated: boolean;
  /** A consent text (D74). */
  readonly critical: boolean;
  /** Placeholders with no parameter, left visible (D71): runtime logs them. */
  readonly missingParams: readonly string[];
}

export type SendTextEffect = Extract<Effect, { type: "SendText" }>;

export interface TextResolver {
  resolve(ref: TextRef, target: TextTarget): Promise<ResolvedText>;
  /** A SendText effect, with the line its purpose adds (D76). */
  resolveSend(effect: SendTextEffect, target: TextTarget): Promise<ResolvedText>;
}

/** D77: the session language, or the campaign default while it is not chosen yet. */
export function outputLanguage(
  sessionLanguage: LanguageCode | null,
  campaign: CampaignDefinition,
): LanguageCode {
  return sessionLanguage ?? campaign.defaultLanguage;
}

function campaignText(campaign: CampaignDefinition, key: string): LocalizedText {
  const text = campaign.texts[key];
  if (!text) throw new Error(`unknown campaign text "${key}"`);
  return text;
}

function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year = "", month = "", day = ""] = match;
  return `${day}/${month}/${year}`;
}

function rendered(
  template: ResolvedTemplate,
  values: Readonly<Record<string, string>>,
  critical: boolean,
): ResolvedText {
  const { text, missing } = interpolate(template.template, values);
  return {
    text,
    language: template.language,
    source: template.source,
    isCurated: template.isCurated,
    critical,
    missingParams: missing,
  };
}

export function createTextResolver(services: TemplateServices): TextResolver {
  async function word(key: I18nTextKey, language: LanguageCode): Promise<string> {
    const entry = SYSTEM_CATALOG[key];
    return (await resolveTemplate(catalogText(entry, {}), language, "system", services)).template;
  }

  /** D75: how a value is shown; dates need the field's definition. */
  async function formatValue(
    value: TextParamValue,
    field: FieldDefinition | undefined,
    language: LanguageCode,
  ): Promise<string> {
    if (value === null) return word("format.empty", language);
    if (typeof value === "boolean") return word(value ? "format.yes" : "format.no", language);
    if (typeof value === "number") return String(value);
    if (typeof value === "string") return field?.type === "date" ? formatDate(value) : value;
    return value.join(", ");
  }

  async function formatPlain(
    params: TextParams,
    language: LanguageCode,
  ): Promise<Record<string, string>> {
    const values: Record<string, string> = {};
    for (const [name, value] of Object.entries(params)) {
      values[name] = await formatValue(value, undefined, language);
    }
    return values;
  }

  async function formatCatalogParams(
    entry: CatalogEntry,
    params: TextParams,
    language: LanguageCode,
    campaign: CampaignDefinition,
  ): Promise<Record<string, string>> {
    const fieldParam = Object.entries(entry.params).find(([, kind]) => kind === "field")?.[0];
    const fieldRef = fieldParam === undefined ? undefined : params[fieldParam];
    const field =
      typeof fieldRef === "string" ? resolveField(fieldRef, campaign.customFields) : undefined;
    const values: Record<string, string> = {};
    for (const [name, kind] of Object.entries(entry.params)) {
      const value = params[name];
      if (kind === "flag" || value === undefined) continue;
      if (kind === "field" && typeof value === "string") {
        const label = fieldLabel(value, campaign.customFields);
        values[name] = (await resolveTemplate(label, language, "label", services)).template;
      } else {
        values[name] = await formatValue(value, kind === "value" ? field : undefined, language);
      }
    }
    return values;
  }

  async function resolveSystem(
    key: CatalogKey,
    params: TextParams,
    target: TextTarget,
  ): Promise<ResolvedText> {
    const entry = SYSTEM_CATALOG[key];
    const template = await resolveTemplate(
      catalogText(entry, params),
      target.language,
      "system",
      services,
    );
    const values = await formatCatalogParams(entry, params, template.language, target.campaign);
    return rendered(template, values, false);
  }

  async function resolve(ref: TextRef, target: TextTarget): Promise<ResolvedText> {
    if (ref.kind === "generated") {
      return {
        text: ref.text,
        language: target.language,
        source: "generated",
        isCurated: false,
        critical: false,
        missingParams: [],
      };
    }
    if (ref.kind === "system") return resolveSystem(ref.key, ref.params ?? {}, target);
    const text = ref.kind === "campaign" ? campaignText(target.campaign, ref.key) : ref.text;
    const consent = consentStepOf(ref, target.campaign);
    const template = await resolveTemplate(
      text,
      target.language,
      consent ? "critical" : "campaign",
      services,
    );
    const values = await formatPlain(ref.params ?? {}, template.language);
    const result = rendered(template, values, consent !== undefined);
    if (!consent || result.isCurated) return result;
    // D74: never a machine translation of a consent alone.
    const link = await resolveSystem(
      "consent.official_link",
      { link: officialLink(consent, target.campaign) },
      target,
    );
    return { ...result, text: `${result.text}\n\n${link.text}` };
  }

  function leadFor(effect: SendTextEffect, target: TextTarget): Promise<ResolvedText> | undefined {
    if (effect.purpose === "rephrase") return resolveSystem("send.rephrase", {}, target);
    const missing = effect.text.kind === "generated" ? undefined : effect.text.params?.["missing"];
    if (effect.purpose === "clarify" && typeof missing === "string") {
      return resolveSystem("send.clarify", { missing }, target);
    }
    return undefined;
  }

  async function resolveSend(effect: SendTextEffect, target: TextTarget): Promise<ResolvedText> {
    const main = await resolve(effect.text, target);
    const pending = leadFor(effect, target);
    if (!pending) return main;
    const lead = await pending;
    return {
      ...main,
      text: `${lead.text}\n${main.text}`,
      isCurated: main.isCurated && lead.isCurated,
      missingParams: [...lead.missingParams, ...main.missingParams],
    };
  }

  return { resolve, resolveSend };
}
