import { InterpretationSchema, type Interpretation } from "../engine/interpretation";
import type { InterpretContext } from "./context";

export type OutputCheck =
  | { readonly ok: true; readonly interpretation: Interpretation }
  | { readonly ok: false; readonly problems: readonly string[] };

/** The parts of the context the output is checked against. */
export type OutputRules = Pick<InterpretContext, "step" | "collected" | "pendingConfirmation">;

const CODE_FENCE = /^```(?:json)?\s*([\s\S]*?)\s*```$/;

/** Some models wrap JSON in a Markdown fence even in JSON mode. */
export function stripCodeFence(content: string): string {
  const trimmed = content.trim();
  return CODE_FENCE.exec(trimmed)?.[1] ?? trimmed;
}

/** "IT", "it-IT", "pt_BR" → "it", "pt". Anything else is left for the schema to refuse. */
export function normalizeLanguageCode(code: string): string {
  return code.trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEmpty(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}

function withoutEmpty(record: Record<string, unknown>, keys: readonly string[]) {
  return Object.fromEntries(
    Object.entries(record).filter(([key, value]) => !(keys.includes(key) && isEmpty(value))),
  );
}

/** D83: what structured-output models commonly emit for "absent", made acceptable. */
export function normalizeInterpretationOutput(raw: unknown): unknown {
  if (!isRecord(raw)) return raw;
  const out = withoutEmpty(raw, ["choice", "editTarget", "offTopicReply"]);
  if (out["patch"] === undefined || out["patch"] === null) out["patch"] = [];
  if (Array.isArray(out["patch"])) {
    out["patch"] = out["patch"].map((entry: unknown) =>
      isRecord(entry) && (entry["evidence"] === undefined || entry["evidence"] === null)
        ? { ...entry, evidence: "" }
        : entry,
    );
  }
  const question = out["currentQuestion"];
  if (isRecord(question)) out["currentQuestion"] = withoutEmpty(question, ["missing"]);
  const language = out["language"];
  if (isRecord(language) && typeof language["code"] === "string") {
    out["language"] = { ...language, code: normalizeLanguageCode(language["code"]) };
  }
  return out;
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map(String).join(".") || "(root)";
}

/**
 * The prompt's editTarget rules the schema cannot express. Both errors get a repair call: the
 * model can fix them, while dropping editTarget would only answer "edit not valid".
 */
function editTargetProblems(interpretation: Interpretation, rules: OutputRules): string[] {
  const target = interpretation.editTarget;
  if (interpretation.intent !== "edit_request" || !target) return [];
  if (target.newValue === undefined || target.newValue === null) {
    return ["editTarget.newValue: required; leave out editTarget when the new value is not stated"];
  }
  if (!rules.collected.some((c) => c.field === target.field)) {
    return [
      "editTarget.field: must be a key from context.collected; new information for an open field is intent answer",
    ];
  }
  return [];
}

/** Prompt rule: offTopicReply and missing reach the candidate as written. */
export const MAX_CANDIDATE_TEXT_WORDS = 25;

const LINK = /https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|it|eu|net|org|info|io|biz|me|co|app)\b/i;
const EMAIL = /\S+@\S+/;
const PHONE_RUN = /\+?\d[\d\s().-]*\d/g;
/** Italian numbers have 9–11 digits; years, ranges and house numbers have fewer. */
const PHONE_DIGITS = 9;

function hasPhoneNumber(text: string): boolean {
  return (text.match(PHONE_RUN) ?? []).some((run) => run.replace(/\D/g, "").length >= PHONE_DIGITS);
}

/** Safe to show the candidate: short, no links, e-mail addresses or phone numbers. */
export function isShowableText(text: string): boolean {
  const words = text.trim().split(/\s+/).length;
  return (
    words <= MAX_CANDIDATE_TEXT_WORDS &&
    !LINK.test(text) &&
    !EMAIL.test(text) &&
    !hasPhoneNumber(text)
  );
}

/**
 * Silent fixes, no repair call: what is dropped has a deterministic fallback in the engine
 * (system.off_topic, a clarification without `missing`), or must never be saved (a patch on a
 * yes/no or on a choice option).
 */
function sanitize(interpretation: Interpretation, rules: OutputRules): Interpretation {
  const {
    editTarget,
    offTopicReply,
    currentQuestion: { missing, ...question },
    ...rest
  } = interpretation;
  // Same-turn data is saved only with a consent answer (D50), never with a yes/no (D84).
  const keepPatch =
    rest.intent !== "choice" ||
    (rules.step?.type === "consent" && rules.pendingConfirmation === null);
  return {
    ...rest,
    patch: keepPatch ? rest.patch : [],
    currentQuestion: {
      ...question,
      ...(missing !== undefined && isShowableText(missing) ? { missing } : {}),
    },
    ...(editTarget && rest.intent === "edit_request" ? { editTarget } : {}),
    ...(offTopicReply !== undefined && isShowableText(offTopicReply) ? { offTopicReply } : {}),
  };
}

/**
 * JSON → normalization (D83) → InterpretationSchema → the prompt's rules on the context.
 * Problems carry paths and messages, never values: they go back to the LLM in the repair call.
 */
export function parseInterpretationOutput(content: string, rules: OutputRules): OutputCheck {
  let raw: unknown;
  try {
    raw = JSON.parse(stripCodeFence(content));
  } catch {
    return { ok: false, problems: ["the reply is not a JSON object"] };
  }
  const result = InterpretationSchema.safeParse(normalizeInterpretationOutput(raw));
  if (!result.success) {
    return {
      ok: false,
      problems: result.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
    };
  }
  const problems = editTargetProblems(result.data, rules);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, interpretation: sanitize(result.data, rules) };
}
