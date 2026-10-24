import { Command } from "commander";
import { VERSION } from "../version";

// Commands are registered here by later plans (campaigns, evals, ops).
export function createProgram(): Command {
  return new Command()
    .name("kubri-bot")
    .description("Kubri Chatbot operations CLI")
    .version(VERSION);
}
