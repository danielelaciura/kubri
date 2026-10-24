import type { Command } from "commander";
import { MetaProviderConfigSchema } from "../../channels/provider-config";
import { SlugSchema } from "../../campaigns/schema/ids";
import { findOrganizationBySlug } from "../../store/organizations";
import {
  createSenderNumber,
  findSenderNumberByPhone,
  findSenderNumberBySlug,
} from "../../store/senders";
import { CliError, type CliDeps } from "../deps";

const E164 = /^\+[1-9]\d{6,14}$/;

interface SenderAddOptions {
  phone: string;
  name: string;
  org?: string;
  phoneNumberId: string;
  wabaId: string;
  tokenSecret: string;
}

export function registerSenderCommands(program: Command, deps: CliDeps): void {
  const senders = program.command("senders").description("Manage WhatsApp sender numbers");

  senders
    .command("add")
    .description("Register a WhatsApp number served through the Meta Cloud API")
    .argument("<slug>", "kebab-case slug, used as trigger.sender in campaign files")
    .requiredOption("--phone <e164>", "the number in E.164 format, e.g. +393331234567")
    .requiredOption("--name <name>", "display name")
    .option("--org <slug>", "owning organization (omit for a shared number)")
    .requiredOption("--phone-number-id <id>", "Meta phone number id")
    .requiredOption("--waba-id <id>", "Meta WhatsApp Business Account id")
    .requiredOption(
      "--token-secret <NAME>",
      "NAME of the env var / secret holding the access token (never the token itself)",
    )
    .action(async (slug: string, options: SenderAddOptions) => {
      if (!SlugSchema.safeParse(slug).success) {
        throw new CliError(`Invalid slug "${slug}": use kebab-case`);
      }
      if (!E164.test(options.phone)) {
        throw new CliError(`Invalid phone "${options.phone}": use E.164, e.g. +393331234567`);
      }
      const config = MetaProviderConfigSchema.safeParse({
        phoneNumberId: options.phoneNumberId,
        wabaId: options.wabaId,
        accessTokenSecret: options.tokenSecret,
      });
      if (!config.success) {
        const details = config.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
        throw new CliError(`Invalid provider config: ${details.join("; ")}`);
      }

      const created = await deps.withDatabase(async (db) => {
        if (await findSenderNumberBySlug(db, slug)) {
          throw new CliError(`Sender "${slug}" already exists`);
        }
        if (await findSenderNumberByPhone(db, options.phone)) {
          throw new CliError(`Phone ${options.phone} is already registered`);
        }
        let organizationId: string | null = null;
        if (options.org !== undefined) {
          const org = await findOrganizationBySlug(db, options.org);
          if (!org) throw new CliError(`Organization "${options.org}" does not exist`);
          organizationId = org.id;
        }
        return createSenderNumber(db, {
          slug,
          organizationId,
          phoneE164: options.phone,
          displayName: options.name.trim(),
          // Manual provisioning: the number is already set up on Meta (spec §17).
          status: "active",
          provider: "meta",
          providerConfig: config.data,
        });
      });
      deps.out(`✓ sender ${created.slug} created (${created.id})`);
    });
}
