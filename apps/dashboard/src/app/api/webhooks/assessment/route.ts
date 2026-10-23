import { NextResponse } from "next/server";
import { assessmentSubmissionSchema, mapAssessmentToCandidate } from "@kubri/contracts";
import { resolvePoolByExternalKey, UnknownPoolError } from "@/lib/pools/resolve";
import { resolveSharedWithGlobal } from "@/lib/pools/global-sharing";
import { ingestCandidate } from "@/lib/candidates/ingest";
import type { Prisma } from "@/generated/prisma/client";

export async function POST(req: Request): Promise<Response> {
  const expected = process.env["ASSESSMENT_WEBHOOK_SECRET"];
  if (!expected || req.headers.get("authorization") !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = assessmentSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    console.error("[webhook assessment] validation failed", parsed.error.flatten());
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const poolKey = process.env["ASSESSMENT_POOL_KEY"] ?? "global";
  let pool;
  try {
    pool = await resolvePoolByExternalKey(poolKey);
  } catch (e) {
    if (e instanceof UnknownPoolError) {
      console.error("[webhook assessment] unknown pool", { poolKey });
      return NextResponse.json({ error: "unknown_pool", poolKey }, { status: 422 });
    }
    throw e;
  }

  const { contact, assessment } = parsed.data;
  const { columns, assessmentProfile } = mapAssessmentToCandidate(assessment);

  const upsertInput: Prisma.CandidateUncheckedCreateInput = {
    externalId: contact.phone,
    poolId: pool.id,
    firstName: contact.firstName,
    lastName: contact.lastName,
    phone: contact.phone,
    location: contact.location,
    latitude: contact.latitude,
    longitude: contact.longitude,
    email: contact.email ?? null,
    channel: "assessment",
    sourceOrganization: "kubri-assessment",
    sharedWithGlobal: resolveSharedWithGlobal(pool, contact.privacyAccepted === true),
    workExperience: columns.workExperience ?? [],
    skillsAndCompetences: columns.skillsAndCompetences ?? [],
    educationAndTraining: columns.educationAndTraining ?? [],
    desiredJob: columns.desiredJob ?? null,
    jobConstraints: columns.jobConstraints ?? null,
    preferredLocation: columns.preferredLocation ?? null,
    partTimePreference: columns.partTimePreference ?? null,
    assessmentProfile: assessmentProfile as Prisma.InputJsonValue,
    rawPayload: parsed.data as unknown as Prisma.InputJsonValue,
  };

  try {
    const { candidateId } = await ingestCandidate(upsertInput, "webhook assessment");
    return NextResponse.json({ ok: true, candidateId });
  } catch (e) {
    console.error("[webhook assessment] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
