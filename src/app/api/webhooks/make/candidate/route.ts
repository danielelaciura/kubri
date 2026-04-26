import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";
import { normalizeForUpsert } from "@/lib/make/normalize";

export async function POST(req: Request): Promise<Response> {
  // 1. Auth
  const expected = process.env["MAKE_WEBHOOK_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // 2. Parse JSON (tolerate malformed body)
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // 3. Structural validation
  const parsed = makeCandidateWebhookSchema.safeParse(body);
  if (!parsed.success) {
    console.error(
      "[webhook make/candidate] validation failed",
      parsed.error.flatten(),
    );
    return NextResponse.json(
      { error: "validation_failed", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  // 4. Normalize + upsert
  const upsertInput = normalizeForUpsert(parsed.data);
  try {
    const candidate = await prisma.candidate.upsert({
      where: {
        makeDatastoreId_externalId: {
          makeDatastoreId: parsed.data.makeDatastoreId,
          externalId: parsed.data.key,
        },
      },
      create: upsertInput,
      update: upsertInput,
      select: { id: true },
    });
    return NextResponse.json({ ok: true, candidateId: candidate.id });
  } catch (e) {
    console.error("[webhook make/candidate] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
