import { InvalidArgumentError, Option, type Command } from "commander";
import { validateCampaign } from "../../campaigns/validate";
import { createTextResolver } from "../../i18n/resolve";
import { MemoryTranslationCache } from "../../i18n/translation-cache";
import { NOOP_TRACE_SINK } from "../../nlu/trace";
import { CliError, type CliDeps } from "../deps";
import { formatIssues } from "../format-issues";
import { readCampaignFile } from "../read-campaign-file";
import {
  INTERPRETER_KINDS,
  TRANSLATOR_KINDS,
  createSimulationServices,
  type SimulationKinds,
} from "../simulate/services";
import { createSimulation } from "../simulate/simulation";
import { printingTraceSink } from "../simulate/trace-printer";

interface SimulateOptions extends SimulationKinds {
  readonly history: number;
  readonly traces: boolean;
}

function parseHistory(value: string): number {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 0) {
    throw new InvalidArgumentError("must be a whole number, 0 or more");
  }
  return size;
}

export function registerSimulateCommand(campaigns: Command, deps: CliDeps): void {
  campaigns
    .command("simulate")
    .description("Run an interview in the terminal on a campaign file (no database, no WhatsApp)")
    .argument("<file>", "campaign JSON file")
    .addOption(
      new Option("--nlu <kind>", "how answers are interpreted")
        .choices(INTERPRETER_KINDS)
        .default("naive"),
    )
    .addOption(
      new Option("--translator <kind>", "how texts are translated")
        .choices(TRANSLATOR_KINDS)
        .default("fake"),
    )
    .option("--history <n>", "earlier user messages given to the NLU", parseHistory, 3)
    .option("--traces", "print one line per LLM call (no content) on stderr", false)
    .action(async (file: string, options: SimulateOptions) => {
      const result = validateCampaign(await readCampaignFile(deps, file));
      if (!result.ok) {
        deps.err(`✗ ${file}: ${result.issues.length} issue(s)`);
        formatIssues(result.issues).forEach(deps.err);
        throw new CliError(`Invalid campaign: ${file}`);
      }
      const services = createSimulationServices(options, deps, {
        traces: options.traces ? printingTraceSink(deps.err) : NOOP_TRACE_SINK,
        historyMessages: options.history,
      });
      const simulation = createSimulation({
        campaign: result.campaign,
        interpreter: services.interpreter,
        resolver: createTextResolver({
          translator: services.translator,
          cache: new MemoryTranslationCache(),
        }),
        now: deps.now,
        historySize: options.history,
      });
      deps.out(
        `Simulating "${result.campaign.campaign}" (nlu=${options.nlu}, translator=${options.translator}). Type /? for the commands, /quit to stop.`,
      );
      (await simulation.start()).forEach(deps.out);
      const input = deps.openInput();
      try {
        for (;;) {
          const line = await input.next("you> ");
          if (line === null) break;
          const reply = await simulation.handle(line);
          if (reply === null) break;
          reply.forEach(deps.out);
        }
      } finally {
        input.close();
      }
    });
}
