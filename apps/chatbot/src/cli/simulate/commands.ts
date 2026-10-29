import type { CampaignDefinition } from "../../campaigns/schema/campaign";
import { InterpretationSchema, type Interpretation } from "../../engine/interpretation";
import type { SessionState } from "../../engine/state";
import { resolveField } from "../../profile/field-ref";
import { baseInterpretation, coerceValue, currentField } from "./interpretations";

export type SimulatorInput =
  /** Sent to the interpreter. */
  | { readonly kind: "text"; readonly text: string }
  /** Sent straight to the engine, whatever the interpreter (D79). */
  | {
      readonly kind: "forced";
      readonly text: string;
      readonly interpretation: Interpretation | null;
    }
  | { readonly kind: "state" }
  | { readonly kind: "usage" }
  | { readonly kind: "quit" }
  | { readonly kind: "invalid"; readonly message: string };

export const USAGE: readonly string[] = [
  "Type the candidate's message, or a command:",
  "  /choice <id>           pick an option (yes, no, accepted, declined, an option id, regenerate_cv)",
  "  /low <value>           answer the current question with low confidence (asks a confirmation)",
  "  /partial <missing>     partial answer: the bot asks for <missing>",
  "  /edit <field> <value>  ask to change a field (e.g. /edit location Bologna)",
  "  /offtopic [reply]      off-topic message, with an optional generated reply",
  "  /help                  the candidate asks for help",
  "  /refuse                the candidate refuses to answer",
  "  /unclear               the NLU could not tell",
  "  /null <text>           NLU unavailable: only the keywords in <text> count",
  "  /nlu <json>            a full Interpretation as JSON",
  "  /state                 show the session state and the profile",
  "  /?                     this help",
  "  /quit                  stop",
];

const invalid = (message: string): SimulatorInput => ({ kind: "invalid", message });
const forced = (text: string, interpretation: Interpretation | null): SimulatorInput => ({
  kind: "forced",
  text,
  interpretation,
});

export function parseInput(
  line: string,
  state: SessionState,
  campaign: CampaignDefinition,
): SimulatorInput {
  const trimmed = line.trim();
  if (trimmed === "") return invalid("empty message: type an answer, or /? for the commands");
  if (!trimmed.startsWith("/")) return { kind: "text", text: trimmed };
  const command = trimmed.split(/\s+/, 1)[0] ?? "";
  const arg = trimmed.slice(command.length).trim();
  const base = baseInterpretation(state, campaign);
  switch (command) {
    case "/quit":
    case "/q":
      return { kind: "quit" };
    case "/state":
      return { kind: "state" };
    case "/?":
      return { kind: "usage" };
    case "/null":
      return forced(arg, null);
    case "/choice":
      return arg
        ? forced(arg, { ...base, intent: "choice", choice: arg })
        : invalid("/choice needs an option id");
    case "/help":
      return forced(arg, { ...base, intent: "help" });
    case "/refuse":
      return forced(arg, { ...base, intent: "refusal" });
    case "/unclear":
      return forced(arg, { ...base, intent: "unclear" });
    case "/offtopic":
      return forced(
        arg,
        arg
          ? { ...base, intent: "off_topic", offTopicReply: arg }
          : { ...base, intent: "off_topic" },
      );
    case "/partial":
      return arg
        ? forced(arg, { ...base, currentQuestion: { completeness: "partial", missing: arg } })
        : invalid("/partial needs what is missing");
    case "/low":
      return lowConfidence(arg, state, campaign, base);
    case "/edit":
      return editRequest(arg, campaign, base);
    case "/nlu":
      return rawInterpretation(arg);
    default:
      return invalid(`unknown command ${command}: /? lists the commands`);
  }
}

function lowConfidence(
  arg: string,
  state: SessionState,
  campaign: CampaignDefinition,
  base: Interpretation,
): SimulatorInput {
  const current = currentField(state, campaign);
  if (!current) return invalid("/low works only while a question is waiting");
  const value = coerceValue(arg, current.definition);
  if (value === undefined) return invalid(`"${arg}" is not a valid ${current.definition.type}`);
  return forced(arg, {
    ...base,
    patch: [{ field: current.ref, value, confidence: 0.5, evidence: arg }],
    currentQuestion: { completeness: "complete" },
  });
}

/** An unknown field is sent anyway: the engine rejects it (edit_invalid), as with the LLM. */
function editRequest(
  arg: string,
  campaign: CampaignDefinition,
  base: Interpretation,
): SimulatorInput {
  const field = arg.split(/\s+/, 1)[0] ?? "";
  const raw = arg.slice(field.length).trim();
  if (field === "" || raw === "") return invalid("/edit needs a field and a value");
  const definition = resolveField(field, campaign.customFields);
  const newValue = (definition && coerceValue(raw, definition)) ?? raw;
  return forced(arg, { ...base, intent: "edit_request", editTarget: { field, newValue } });
}

function rawInterpretation(arg: string): SimulatorInput {
  let json: unknown;
  try {
    json = JSON.parse(arg);
  } catch {
    return invalid("/nlu needs a JSON object");
  }
  const parsed = InterpretationSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return invalid(`not an Interpretation: ${issues.join("; ")}`);
  }
  return forced("", parsed.data);
}
