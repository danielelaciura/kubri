/**
 * One-off backfill: normalize JobDescription.name casing (see
 * lib/jobs/normalize-name) and re-embed renamed JDs, since the name is part
 * of the embedding text. Names that would collide with another JD of the same
 * org are skipped and reported.
 *
 * Run: set -a && source .env.local && set +a && pnpm tsx scripts/normalize-job-names.ts [--dry-run]
 *
 * Idempotent. Safe to re-run.
 */
import { prisma } from "@/lib/db";
import { planJobNameRenames } from "@/lib/jobs/normalize-name";
import { syncJobDescriptionEmbedding } from "@/lib/jobs/service";

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: unknown }).code === "P2002";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const rows = await prisma.jobDescription.findMany({
    select: { id: true, organizationId: true, name: true, description: true, skills: true },
  });
  const plan = planJobNameRenames(rows);
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const c of plan.collisions) {
    console.warn(`[collision] org=${c.organizationId} jd=${c.id} "${c.from}" -> "${c.to}" (skipped)`);
  }

  let renamed = 0;
  let raceCollisions = 0;
  let embeddingErrors = 0;

  for (const r of plan.renames) {
    console.log(`[rename] org=${r.organizationId} jd=${r.id} "${r.from}" -> "${r.to}"`);
    if (dryRun) continue;
    const row = byId.get(r.id);
    if (!row) continue;
    try {
      await prisma.jobDescription.update({ where: { id: r.id }, data: { name: r.to } });
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      raceCollisions++;
      console.warn(`[collision] jd=${r.id} "${r.to}" taken meanwhile (skipped)`);
      continue;
    }
    renamed++;
    const ok = await syncJobDescriptionEmbedding(r.id, {
      name: r.to,
      description: row.description,
      skills: row.skills,
    });
    if (!ok) embeddingErrors++;
  }

  console.log(
    [
      dryRun ? "DRY RUN — nothing written." : "Done.",
      `to rename: ${plan.renames.length}`,
      `renamed: ${renamed}`,
      `unchanged: ${plan.unchanged}`,
      `skipped (collision): ${plan.collisions.length + raceCollisions}`,
      `embedding errors: ${embeddingErrors}`,
    ].join("\n"),
  );
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
