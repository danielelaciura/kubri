import { Command } from "commander";
import { VERSION } from "../version";
import { registerCampaignCommands } from "./commands/campaigns";
import { registerInboundCommands } from "./commands/inbound";
import { registerOrgCommands } from "./commands/orgs";
import { registerSenderCommands } from "./commands/senders";
import { registerWorkerCommands } from "./commands/worker";
import type { CliDeps } from "./deps";

// Later plans register more commands here (simulate, evals, ops).
export function createProgram(deps: CliDeps): Command {
  const program = new Command()
    .name("kubri-bot")
    .description("Kubri Chatbot operations CLI")
    .version(VERSION);
  registerOrgCommands(program, deps);
  registerSenderCommands(program, deps);
  registerCampaignCommands(program, deps);
  registerWorkerCommands(program, deps);
  registerInboundCommands(program, deps);
  return program;
}
