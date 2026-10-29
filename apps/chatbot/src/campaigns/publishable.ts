import type { NodeEnv } from "../config/env";
import { issue, type CampaignIssue } from "./issues";
import type { CampaignDefinition } from "./schema/campaign";

/** Spec D23 / Appendix A: placeholder consent texts must never reach production. */
export const PLACEHOLDER_TEXT_VERSION_PREFIX = "placeholder-";

/** Marker the Kubri team writes at the start of draft consent texts (Appendix A). */
export const PLACEHOLDER_TEXT_MARKER = "[testo segnaposto]";

function isPlaceholderVersion(textVersion: string): boolean {
  return textVersion.toLowerCase().startsWith(PLACEHOLDER_TEXT_VERSION_PREFIX);
}

function placeholderTextIssues(
  basePath: string,
  consentKey: string,
  text: Readonly<Record<string, string>>,
): CampaignIssue[] {
  return Object.entries(text)
    .filter(([, value]) => value.toLowerCase().includes(PLACEHOLDER_TEXT_MARKER))
    .map(([lang]) =>
      issue(
        `${basePath}.${lang}`,
        "placeholder_consent",
        `Consent "${consentKey}" shows placeholder text ("[TESTO SEGNAPOSTO]"): not allowed in production`,
      ),
    );
}

export function placeholderConsentIssues(c: CampaignDefinition): CampaignIssue[] {
  const issues: CampaignIssue[] = [];
  c.flow.forEach((step, i) => {
    if (step.type !== "consent") return;
    if (isPlaceholderVersion(step.textVersion)) {
      issues.push(
        issue(
          `flow[${i}].textVersion`,
          "placeholder_consent",
          `Consent "${step.consentKey}" uses the placeholder text version "${step.textVersion}": not allowed in production`,
        ),
      );
    }
    if ("ref" in step.text) {
      const referenced = c.texts[step.text.ref];
      if (referenced) {
        issues.push(
          ...placeholderTextIssues(`texts.${step.text.ref}`, step.consentKey, referenced),
        );
      }
    } else {
      issues.push(...placeholderTextIssues(`flow[${i}].text`, step.consentKey, step.text));
    }
  });
  return issues;
}

export interface PublishCheck {
  /** Block the import. */
  readonly errors: CampaignIssue[];
  /** Printed, but the import goes ahead. */
  readonly warnings: CampaignIssue[];
}

/**
 * Placeholder consents are warnings only when NODE_ENV is explicitly "development" or
 * "test"; production, an unset NODE_ENV and anything else make them errors.
 */
export function checkPublishable(
  c: CampaignDefinition,
  nodeEnv: NodeEnv | undefined,
): PublishCheck {
  const placeholders = placeholderConsentIssues(c);
  return nodeEnv === "development" || nodeEnv === "test"
    ? { errors: [], warnings: placeholders }
    : { errors: placeholders, warnings: [] };
}
