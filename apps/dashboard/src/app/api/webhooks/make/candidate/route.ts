import { NextResponse } from "next/server";
import { makeCandidateWebhookSchema } from "@/lib/validations/webhook-candidate";
import { normalizeForUpsert } from "@/lib/make/normalize";
import {
  resolvePoolByExternalKey,
  UnknownPoolError,
} from "@/lib/pools/resolve";
import { ingestCandidate } from "@/lib/candidates/ingest";

export async function POST(req: Request): Promise<Response> {
  const expected = process.env["MAKE_WEBHOOK_SECRET"];
  const auth = req.headers.get("authorization");
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

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

  let pool;
  try {
    pool = await resolvePoolByExternalKey(parsed.data.externalKey);
  } catch (e) {
    if (e instanceof UnknownPoolError) {
      console.error("[webhook make/candidate] unknown pool", {
        externalKey: e.externalKey,
      });
      return NextResponse.json(
        { error: "unknown_pool", externalKey: e.externalKey },
        { status: 422 },
      );
    }
    throw e;
  }

  const upsertInput = normalizeForUpsert(parsed.data, pool);
  try {
    const { candidateId } = await ingestCandidate(
      upsertInput,
      "webhook make/candidate",
    );
    return NextResponse.json({ ok: true, candidateId });
  } catch (e) {
    console.error("[webhook make/candidate] upsert failed", e);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
