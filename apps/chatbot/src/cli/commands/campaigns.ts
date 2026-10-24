import type { Command } from "commander";
import { importCampaign, type ImportCampaignResult } from "../../campaigns/import";
import type { CampaignIssue } from "../../campaigns/issues";
import { checkPublishable } from "../../campaigns/publishable";
import { validateCampaign } from "../../campaigns/validate";
import { listCampaigns } from "../../store/campaigns";
import { CliError, type CliDeps } from "../deps";
import { describeEnvironment, formatIssues, hasPlaceholderIssue } from "../format-issues";
import { readCampaignFile } from "../read-campaign-file";

/** Prisma: transaction failed on a write conflict / deadlock under SERIALIZABLE. */
const SERIALIZATION_FAILURE = "P2034";
/** Prisma: unique constraint violated (e.g. two imports creating the same version number). */
const UNIQUE_VIOLATION = "P2002";

function stringProperty(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const found = (value as Record<string, unknown>)[key];
  return typeof found === "string" ? found : undefined;
}

/** SQLSTATE: serialization_failure and unique_violation, as the pg driver reports them. */
const PG_SERIALIZATION_FAILURE = "40001";
const PG_UNIQUE_VIOLATION = "23505";

/**
 * Two imports of the same campaign raced: the loser is told to retry, not shown a stack.
 * Prisma reports the race as `code` P2034/P2002, but the pg driver adapter throws a
 * `DriverAdapterError` with no `code`: the detail is in `cause` (`kind` / `originalCode`).
 */
function isConcurrentImportError(error: unknown): boolean {
  const code = stringProperty(error, "code");
  if (code === SERIALIZATION_FAILURE || code === UNIQUE_VIOLATION) return true;
  const cause =
    typeof error === "object" && error !== null && "cause" in error ? error.cause : null;
  const kind = stringProperty(cause, "kind");
  const originalCode = stringProperty(cause, "originalCode");
  return (
    kind === "TransactionWriteConflict" ||
    kind === "UniqueConstraintViolation" ||
    originalCode === PG_SERIALIZATION_FAILURE ||
    originalCode === PG_UNIQUE_VIOLATION
  );
}

export function registerCampaignCommands(program: Command, deps: CliDeps): void {
  const campaigns = program.command("campaigns").description("Validate, import and list campaigns");

  /** Warnings/errors lines, plus the effective environment when placeholders are involved. */
  function report(issues: readonly CampaignIssue[], marker: string): void {
    if (issues.length === 0) return;
    formatIssues(issues, marker).forEach(deps.err);
    if (hasPlaceholderIssue(issues)) deps.err(describeEnvironment(deps.nodeEnv()));
  }

  campaigns
    .command("validate")
    .description("Validate a campaign file without touching the database")
    .argument("<file>", "campaign JSON file")
    .action(async (file: string) => {
      const input = await readCampaignFile(deps, file);
      const result = validateCampaign(input);
      if (!result.ok) {
        deps.err(`✗ ${file}: ${result.issues.length} issue(s)`);
        formatIssues(result.issues).forEach(deps.err);
        throw new CliError(`Invalid campaign: ${file}`);
      }
      const { errors, warnings } = checkPublishable(result.campaign, deps.nodeEnv());
      if (errors.length > 0) {
        deps.err(`✗ ${file}: not publishable in this environment`);
        report(errors, "✗");
        throw new CliError(`Campaign not publishable: ${file}`);
      }
      report(warnings, "!");
      deps.out(`✓ ${file}: campaign "${result.campaign.campaign}" is valid`);
    });

  campaigns
    .command("import")
    .description("Validate a campaign file and store it as a new immutable version")
    .argument("<file>", "campaign JSON file")
    .option("--activate", "make this version the active one", false)
    .option("--imported-by <name>", "who is importing (stored on the version)")
    .action(async (file: string, options: { activate: boolean; importedBy?: string }) => {
      const input = await readCampaignFile(deps, file);
      let result: ImportCampaignResult;
      try {
        result = await deps.withDatabase((db) =>
          importCampaign(db, input, {
            activate: options.activate,
            nodeEnv: deps.nodeEnv(),
            importedBy: options.importedBy ?? null,
          }),
        );
      } catch (error: unknown) {
        if (isConcurrentImportError(error)) {
          throw new CliError(
            `✗ ${file}: import concorrente, riprova (another import of this campaign was running)`,
          );
        }
        throw error;
      }
      if (!result.ok) {
        deps.err(`✗ ${file}: import refused, ${result.issues.length} issue(s)`);
        report(result.issues, "✗");
        throw new CliError(`Import refused: ${file}`);
      }
      report(result.warnings, "!");
      const what = result.outcome === "created" ? "created" : "unchanged, reusing";
      const state = result.active ? "active" : "not active (use --activate)";
      deps.out(`✓ ${file}: ${what} version ${result.version}, ${state}`);
    });

  campaigns
    .command("list")
    .description("List campaigns with their active and latest versions")
    .action(async () => {
      const rows = await deps.withDatabase((db) => listCampaigns(db));
      if (rows.length === 0) {
        deps.out("No campaigns.");
        return;
      }
      for (const row of rows) {
        const active = row.activeVersion === null ? "-" : `v${row.activeVersion}`;
        const trigger = row.isDefault ? "default" : row.keywords.join(", ");
        deps.out(
          `${row.slug}  [${row.status}]  org=${row.organizationSlug}  sender=${row.senderSlug}  active=${active}  latest=v${row.latestVersion}  trigger=${trigger}`,
        );
      }
    });
}
