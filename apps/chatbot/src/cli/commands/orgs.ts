import type { Command } from "commander";
import { SlugSchema } from "../../campaigns/schema/ids";
import { createOrganization, findOrganizationBySlug } from "../../store/organizations";
import { CliError, type CliDeps } from "../deps";

export function registerOrgCommands(program: Command, deps: CliDeps): void {
  const orgs = program.command("orgs").description("Manage organizations");

  orgs
    .command("add")
    .description("Create an organization")
    .argument("<slug>", "kebab-case slug, used by campaign files")
    .requiredOption("--name <name>", "display name")
    .action(async (slug: string, options: { name: string }) => {
      if (!SlugSchema.safeParse(slug).success) {
        throw new CliError(`Invalid slug "${slug}": use kebab-case`);
      }
      const name = options.name.trim();
      if (name === "") throw new CliError("--name cannot be empty");

      const created = await deps.withDatabase(async (db) => {
        if (await findOrganizationBySlug(db, slug)) {
          throw new CliError(`Organization "${slug}" already exists`);
        }
        return createOrganization(db, { slug, name });
      });
      deps.out(`✓ organization ${created.slug} created (${created.id})`);
    });
}
