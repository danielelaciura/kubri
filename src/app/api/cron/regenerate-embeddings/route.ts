import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { generateEmbedding, vectorToPgLiteral } from "@/lib/embeddings/client";
import {
  buildCandidateEmbeddingText,
  buildJobDescriptionEmbeddingText,
} from "@/lib/embeddings/text";

const MAX_PER_RUN = 500;

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

export async function GET(req: Request): Promise<Response> {
  const expected = process.env["CRON_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let candidates = 0;
  const candBatch = await prisma.$queryRaw<CandidateRow[]>`
    SELECT id::text AS id, "skillsAndCompetences", "workExperience",
           "educationAndTraining", "desiredJob", "jobConstraints"
    FROM "Candidate"
    WHERE embedding IS NULL
    LIMIT ${MAX_PER_RUN}
  `;
  for (const c of candBatch) {
    const text = buildCandidateEmbeddingText(c);
    if (!text) continue;
    try {
      const v = await generateEmbedding(text);
      await prisma.$executeRaw`
        UPDATE "Candidate"
        SET "embedding" = ${vectorToPgLiteral(v)}::vector,
            "embeddingText" = ${text},
            "embeddingUpdatedAt" = now()
        WHERE id = ${c.id}::uuid
      `;
      candidates++;
    } catch (e) {
      console.error("[cron] candidate embedding failed", c.id, e);
    }
  }

  let jobs = 0;
  const jobBatch = await prisma.$queryRaw<JobRow[]>`
    SELECT id::text AS id, name, description, skills
    FROM "JobDescription"
    WHERE embedding IS NULL
    LIMIT ${MAX_PER_RUN}
  `;
  for (const j of jobBatch) {
    const text = buildJobDescriptionEmbeddingText(j);
    if (!text) continue;
    try {
      const v = await generateEmbedding(text);
      await prisma.$executeRaw`
        UPDATE "JobDescription"
        SET "embedding" = ${vectorToPgLiteral(v)}::vector,
            "embeddingText" = ${text},
            "embeddingUpdatedAt" = now()
        WHERE id = ${j.id}::uuid
      `;
      jobs++;
    } catch (e) {
      console.error("[cron] job embedding failed", j.id, e);
    }
  }

  return NextResponse.json({ candidates, jobs });
}
