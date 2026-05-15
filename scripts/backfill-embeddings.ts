/**
 * Backfill embeddings for existing Candidate and JobDescription rows.
 *
 * Run: set -a && source .env.local && set +a && pnpm tsx scripts/backfill-embeddings.ts
 *   --target=candidates|jobs|all   (default: all)
 *   --force                        re-embed every row, not just IS NULL
 *
 * Idempotent. Safe to re-run.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

type Target = "candidates" | "jobs" | "all";

function parseArgs(): { target: Target; force: boolean } {
  const args = process.argv.slice(2);
  let target: Target = "all";
  let force = false;
  for (const a of args) {
    if (a.startsWith("--target=")) {
      const v = a.slice("--target=".length);
      if (v === "candidates" || v === "jobs" || v === "all") target = v;
    }
    if (a === "--force") force = true;
  }
  return { target, force };
}

function buildWhere(force: boolean, cursor: string | null): Prisma.Sql {
  if (force) {
    return cursor
      ? Prisma.sql`WHERE id > ${cursor}::uuid`
      : Prisma.empty;
  }
  return cursor
    ? Prisma.sql`WHERE embedding IS NULL AND id > ${cursor}::uuid`
    : Prisma.sql`WHERE embedding IS NULL`;
}

interface CandidateRow {
  id: string;
  skillsAndCompetences: string[];
  workExperience: string[];
  educationAndTraining: string[];
  desiredJob: string | null;
  jobConstraints: string | null;
}

interface JobRow {
  id: string;
  name: string;
  description: string;
  skills: string[];
}

async function backfillCandidates(force: boolean): Promise<void> {
  const totalWhere = force ? Prisma.empty : Prisma.sql`WHERE embedding IS NULL`;
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "Candidate" ${totalWhere}
  `;
  const total = Number(countResult[0].count);
  console.log(`[candidates] ${total} records to process`);

  let done = 0;
  let cursor: string | null = null;
  let prevFirstId: string | null = null;
  while (true) {
    const where = buildWhere(force, cursor);
    const batch = await prisma.$queryRaw<CandidateRow[]>`
      SELECT id::text AS id, "skillsAndCompetences", "workExperience",
             "educationAndTraining", "desiredJob", "jobConstraints"
      FROM "Candidate"
      ${where}
      ORDER BY id ASC
      LIMIT 50
    `;
    if (batch.length === 0) break;

    // Stall guard: if a batch comes back with the same first id and we are not
    // using a cursor (default mode), every row must have failed to update.
    // Bail to avoid an infinite loop on a persistent embedding-service error.
    if (!force && prevFirstId !== null && batch[0]!.id === prevFirstId) {
      console.error(
        "[candidates] aborting: same batch returned twice — embedding service is failing for all rows",
      );
      break;
    }
    prevFirstId = batch[0]!.id;

    for (const c of batch) {
      const text = buildCandidateEmbeddingText(c);
      if (text.length === 0) {
        done++;
        continue;
      }
      try {
        const v = await generateEmbedding(text);
        await prisma.$executeRaw`
          UPDATE "Candidate"
          SET "embedding" = ${vectorToPgLiteral(v)}::vector,
              "embeddingText" = ${text},
              "embeddingUpdatedAt" = now()
          WHERE id = ${c.id}::uuid
        `;
      } catch (e) {
        console.error(`[candidates] ${c.id} failed`, e);
      }
      done++;
      console.log(`[candidates] ${done}/${total} ${c.id} ok`);
    }

    // With --force the cursor advances across all rows. Without --force the
    // WHERE filter shrinks as rows get embeddings, so we keep paging from
    // the start of the residual set.
    if (force) {
      const last = batch[batch.length - 1];
      if (!last) break;
      cursor = last.id;
    }
  }
}

async function backfillJobs(force: boolean): Promise<void> {
  const totalWhere = force ? Prisma.empty : Prisma.sql`WHERE embedding IS NULL`;
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*)::bigint AS count FROM "JobDescription" ${totalWhere}
  `;
  const total = Number(countResult[0].count);
  console.log(`[jobs] ${total} records to process`);

  let done = 0;
  let cursor: string | null = null;
  let prevFirstId: string | null = null;
  while (true) {
    const where = buildWhere(force, cursor);
    const batch = await prisma.$queryRaw<JobRow[]>`
      SELECT id::text AS id, name, description, skills
      FROM "JobDescription"
      ${where}
      ORDER BY id ASC
      LIMIT 50
    `;
    if (batch.length === 0) break;

    if (!force && prevFirstId !== null && batch[0]!.id === prevFirstId) {
      console.error(
        "[jobs] aborting: same batch returned twice — embedding service is failing for all rows",
      );
      break;
    }
    prevFirstId = batch[0]!.id;

    for (const j of batch) {
      const text = buildJobDescriptionEmbeddingText(j);
      if (text.length === 0) {
        done++;
        continue;
      }
      try {
        const v = await generateEmbedding(text);
        await prisma.$executeRaw`
          UPDATE "JobDescription"
          SET "embedding" = ${vectorToPgLiteral(v)}::vector,
              "embeddingText" = ${text},
              "embeddingUpdatedAt" = now()
          WHERE id = ${j.id}::uuid
        `;
      } catch (e) {
        console.error(`[jobs] ${j.id} failed`, e);
      }
      done++;
      console.log(`[jobs] ${done}/${total} ${j.id} ok`);
    }

    if (force) {
      const last = batch[batch.length - 1];
      if (!last) break;
      cursor = last.id;
    }
  }
}

async function main(): Promise<void> {
  const { target, force } = parseArgs();
  if (target === "all" || target === "candidates") await backfillCandidates(force);
  if (target === "all" || target === "jobs") await backfillJobs(force);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
