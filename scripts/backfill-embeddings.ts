import "dotenv/config";
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

async function backfillCandidates(force: boolean) {
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "Candidate" WHERE embedding IS NULL
  `;
  const total = Number(countResult[0].count);
  console.log(`[candidates] ${total} records to process`);
  let done = 0;
  let offset = 0;
  while (true) {
    const batch = await prisma.$queryRaw<
      Array<{
        id: string;
        skillsAndCompetences: string[];
        workExperience: string[];
        educationAndTraining: string[];
        desiredJob: string | null;
        jobConstraints: string | null;
      }>
    >`
      SELECT id, "skillsAndCompetences", "workExperience", "educationAndTraining", "desiredJob", "jobConstraints"
      FROM "Candidate"
      WHERE embedding IS NULL
      ORDER BY "createdAt" ASC
      LIMIT 50
      OFFSET ${offset}
    `;
    if (batch.length === 0) break;
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
    offset += batch.length;
    if (!force) break;
  }
}

async function backfillJobs(force: boolean) {
  const countResult = await prisma.$queryRaw<[{ count: bigint }]>`
    SELECT COUNT(*) as count FROM "JobDescription" WHERE embedding IS NULL
  `;
  const total = Number(countResult[0].count);
  console.log(`[jobs] ${total} records to process`);
  let done = 0;
  let offset = 0;
  while (true) {
    const batch = await prisma.$queryRaw<
      Array<{ id: string; name: string; description: string; skills: string[] }>
    >`
      SELECT id, name, description, skills
      FROM "JobDescription"
      WHERE embedding IS NULL
      ORDER BY "createdAt" ASC
      LIMIT 50
      OFFSET ${offset}
    `;
    if (batch.length === 0) break;
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
    offset += batch.length;
    if (!force) break;
  }
}

async function main() {
  const { target, force } = parseArgs();
  if (target === "all" || target === "candidates") await backfillCandidates(force);
  if (target === "all" || target === "jobs") await backfillJobs(force);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
